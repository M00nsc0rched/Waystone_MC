$ErrorActionPreference = "Stop"
# Vanilla sources (villager_v2.json, creeper.json, economy_trades/*.json) live next to
# this script in tools_vanilla/. They were extracted from the installed game's
# behavior_packs/<vanilla_x.y.z>/__brarchive/*.brarchive (16-byte header, 256-byte
# name entries with offset/size at +248/+252, raw JSON payloads); the five trade
# tables stored in Mojang's binary JSON were taken from github.com/Mojang/bedrock-samples.
$src = Join-Path $PSScriptRoot "tools_vanilla"
$bp = Join-Path $PSScriptRoot "WaypointMonuments_BP"
$TAX = 1.3

# PowerShell escapes <, >, & and quotes as \uXXXX in JSON (an XSS habit). Minecraft
# parses the villager schedule filters literally, so "operator":"<" is not a
# valid operator and the whole entity definition is rejected. Undo those escapes
# and write UTF-8 without a BOM.
function Write-Json($object, $path) {
  $json = $object | ConvertTo-Json -Depth 40 -Compress
  $json = $json -replace "\\u003c", "<" -replace "\\u003e", ">" -replace "\\u0026", "&" -replace "\\u0027", "'" -replace "\\u0060", "``"
  if ($json -match "\\u00[0-9a-fA-F]{2}") { throw "unexpected unicode escape left in $path" }
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  return $json
}


# ---------------------------------------------------------------- trade tables
New-Item -ItemType Directory -Force (Join-Path $bp "trading\wp_taxed") | Out-Null
function Tax-Quantity($q) {
  if ($q -is [System.Management.Automation.PSCustomObject]) {
    if ($q.PSObject.Properties["min"]) { $q.min = [Math]::Min(64, [Math]::Ceiling($q.min * $TAX)) }
    if ($q.PSObject.Properties["max"]) { $q.max = [Math]::Min(64, [Math]::Ceiling($q.max * $TAX)) }
    return $q
  }
  return [int][Math]::Min(64, [Math]::Ceiling([double]$q * $TAX))
}
$tradeCount = 0
foreach ($file in Get-ChildItem (Join-Path $src "economy_trades") -Filter "*.json") {
  if ($file.Name -eq "wandering_trader_trades.json") { continue }
  $t = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($tier in $t.tiers) {
    $trades = @()
    if ($tier.PSObject.Properties["trades"]) { $trades += $tier.trades }
    if ($tier.PSObject.Properties["groups"]) { foreach ($g in $tier.groups) { $trades += $g.trades } }
    foreach ($trade in $trades) {
      foreach ($want in $trade.wants) {
        $targets = @()
        if ($want.PSObject.Properties["choice"]) { $targets += $want.choice } else { $targets += $want }
        foreach ($w in $targets) {
          if ($w.PSObject.Properties["quantity"]) { $w.quantity = Tax-Quantity $w.quantity }
          else { $w | Add-Member -NotePropertyName quantity -NotePropertyValue 2 }
          $tradeCount++
        }
      }
    }
  }
  Write-Json $t (Join-Path $bp "trading\wp_taxed\$($file.Name)") | Out-Null
}
"taxed trade entries: $tradeCount"

# ---------------------------------------------------------------- villager_v2.json
$j = Get-Content (Join-Path $src "villager_v2.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ent = $j.'minecraft:entity'
$ent.description.is_summonable = $true

$professions = @()
foreach ($p in $ent.component_groups.PSObject.Properties) {
  $g = $p.Value
  if ($g.PSObject.Properties["minecraft:economy_trade_table"] -and $g.'minecraft:economy_trade_table'.PSObject.Properties["table"]) {
    $professions += [pscustomobject]@{ name = $p.Name; variant = $g.'minecraft:variant'.value; table = $g.'minecraft:economy_trade_table'.table }
  }
}
"professions with trade tables: " + ($professions | ForEach-Object { "$($_.name)=$($_.variant)" }) -join ", "

# Villagers keep their vanilla behaviour: they do not fight (defence is the
# Village Guard's job). The override only adds the grudge pricing, plus a
# marker family so the script can verify this definition is the one loaded.
$MARKER_FAMILY = "wp_villager_plus"
$ent.components.'minecraft:type_family'.family += $MARKER_FAMILY
foreach ($p in $ent.component_groups.PSObject.Properties) {
  $g = $p.Value
  if ($g.PSObject.Properties["minecraft:type_family"]) { $g.'minecraft:type_family'.family += $MARKER_FAMILY }
}

# Taxed clones: identical to the profession group except for the trade table path.
foreach ($prof in $professions) {
  $clone = ($ent.component_groups.($prof.name) | ConvertTo-Json -Depth 32 -Compress) | ConvertFrom-Json
  $clone.'minecraft:economy_trade_table'.table = $prof.table -replace "economy_trades", "wp_taxed"
  $ent.component_groups | Add-Member -NotePropertyName ("wp:taxed_" + $prof.name) -NotePropertyValue $clone
}
$taxSeq = @()
foreach ($prof in $professions) {
  $taxSeq += [pscustomobject][ordered]@{
    filters = [ordered]@{ test = "is_variant"; value = [int]$prof.variant }
    remove = [ordered]@{ component_groups = @($prof.name) }
    add = [ordered]@{ component_groups = @("wp:taxed_" + $prof.name) }
  }
}
$ent.events | Add-Member -NotePropertyName "wp:apply_tax" -NotePropertyValue ([pscustomobject][ordered]@{ sequence = $taxSeq })

New-Item -ItemType Directory -Force (Join-Path $bp "entities") | Out-Null
$out = Write-Json $j (Join-Path $bp "entities\villager_v2.json")
"villager_v2.json written: " + $out.Length + " chars"

# ---------------------------------------------------------------- creeper.json
# Village Guards hunt creepers, so creepers must not retaliate against them (nor
# against villagers): the vanilla hurt_by_target, which targets whoever hurt the
# creeper, is limited to everything else. Player targeting is untouched, so a
# creeper still swells at an approaching player.
$cj = Get-Content (Join-Path $src "creeper.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$cc = $cj.'minecraft:entity'.components
$cc.'minecraft:behavior.hurt_by_target' = [pscustomobject][ordered]@{
  priority = 2
  entity_types = @([pscustomobject][ordered]@{
    filters = [ordered]@{ all_of = @(
        [ordered]@{ test = "is_family"; subject = "other"; operator = "!="; value = "villager" },
        [ordered]@{ test = "is_family"; subject = "other"; operator = "!="; value = "wp_guard" }
      ) }
  })
}
$creeperOut = Write-Json $cj (Join-Path $bp "entities/creeper.json")
"creeper.json written: " + $creeperOut.Length + " chars"

# ---------------------------------------------------------------- minecarts
# 10x rail speed. The vanilla cap is 0.4 blocks/tick (8 m/s); the script side
# (gameplay.js minecart rule) accelerates carts on powered rails up to this cap,
# so keep GAMEPLAY_CONFIG.minecart.maxSpeed in step with MINECART_MAX_SPEED.
$MINECART_MAX_SPEED = 4.0
foreach ($cart in "minecart.json", "chest_minecart.json", "hopper_minecart.json") {
  $mj = Get-Content (Join-Path $src $cart) -Raw -Encoding UTF8 | ConvertFrom-Json
  $mc = $mj.'minecraft:entity'.components
  $mc.'minecraft:rail_movement' = [pscustomobject][ordered]@{ max_speed = $MINECART_MAX_SPEED }
  # The engine's serialized form carries "events": null; drop it rather than ship a null.
  $me = $mj.'minecraft:entity'
  if ($me.PSObject.Properties["events"] -and $null -eq $me.events) { $me.PSObject.Properties.Remove("events") }
  Write-Json $mj (Join-Path $bp "entities\$cart") | Out-Null
  "$cart written: rail_movement=" + ($mc.'minecraft:rail_movement' | ConvertTo-Json -Compress)
}

# ---------------------------------------------------------------- verification
$creeperCheck = Get-Content (Join-Path $bp "entities\creeper.json") -Raw -Encoding UTF8 | ConvertFrom-Json
"creeper hurt_by_target: " + ($creeperCheck.'minecraft:entity'.components.'minecraft:behavior.hurt_by_target' | ConvertTo-Json -Depth 8 -Compress)
$origC = Get-Content (Join-Path $src "creeper.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$origC.'minecraft:entity'.components.PSObject.Properties.Remove('minecraft:behavior.hurt_by_target')
$creeperCheck.'minecraft:entity'.components.PSObject.Properties.Remove('minecraft:behavior.hurt_by_target')
"creeper otherwise unchanged: " + (($origC | ConvertTo-Json -Depth 40 -Compress) -eq ($creeperCheck | ConvertTo-Json -Depth 40 -Compress))
$check = Get-Content (Join-Path $bp "entities\villager_v2.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ce = $check.'minecraft:entity'
"groups: " + ($ce.component_groups.PSObject.Properties | Measure-Object).Count + " (vanilla 54 + 13 taxed = 67)"
"events: " + ($ce.events.PSObject.Properties | Measure-Object).Count + " (vanilla 38 + 1 apply_tax = 39)"
"no combat components: " + (@("minecraft:attack","minecraft:behavior.nearest_attackable_target","minecraft:behavior.hurt_by_target","minecraft:behavior.melee_box_attack") | ForEach-Object { $null -eq $ce.components.PSObject.Properties[$_] } | Sort-Object -Unique)
"vanilla avoid_mob_type kept: " + ($null -ne $ce.components.PSObject.Properties["minecraft:behavior.avoid_mob_type"])
"marker family in base: " + ($ce.components.'minecraft:type_family'.family -contains $MARKER_FAMILY) + ", in armorer: " + ($ce.component_groups.armorer.'minecraft:type_family'.family -contains $MARKER_FAMILY)
"taxed armorer table: " + $ce.component_groups.'wp:taxed_armorer'.'minecraft:economy_trade_table'.table
"apply_tax entries: " + $ce.events.'wp:apply_tax'.sequence.Count
# sanity: apart from the marker family the vanilla base data is untouched
$orig = Get-Content (Join-Path $src "villager_v2.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$oc = $orig.'minecraft:entity'.components
$mine = $ce.components | ConvertTo-Json -Depth 32 -Compress | ConvertFrom-Json
$mine.'minecraft:type_family'.family = @($mine.'minecraft:type_family'.family | Where-Object { $_ -ne $MARKER_FAMILY })
"base components otherwise unchanged: " + (($oc | ConvertTo-Json -Depth 32 -Compress) -eq ($mine | ConvertTo-Json -Depth 32 -Compress))
# every schema-risky field we add anywhere must be vanilla-proven
$guardPath = Join-Path $bp "entities\wp_village_guard.json"
if (Test-Path $guardPath) {
  $guard = Get-Content $guardPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $mb = $guard.'minecraft:entity'.component_groups.'wp:melee'.'minecraft:behavior.melee_box_attack'
  "guard melee_box_attack fields: " + (($mb.PSObject.Properties | ForEach-Object { $_.Name }) -join ", ")
}
