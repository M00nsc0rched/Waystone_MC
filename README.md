# Waypoint Monuments — Minecraft Bedrock addon (v1.7.0)

Kraftolható **Waypoint Monument** (obeliszk) blokk, amely az alá helyezett aktivátor-blokk szerint
**Teleport Waypoint** (redstone blokk), **Enchanting Waypoint** (lapis lazuli blokk) vagy
**Sanctuary Waypoint** (gyémánt blokk) lesz — plusz néhány világszintű játékmenet-szabály
(útblokk-sebesség, waypoint-limit, erősebben sebző mobok, nem romboló creeperek), XP-költségek, és egy
emulált zsebdimenzió, **The Deep Sky** (Slow Falling potion + Teleport Waypoint), valamint **Village Guard** NPC-k (zöld zászlós pillagerek), akik a falvakat védik, és
**haragtartó, önállóan szaporodó falusiak**.

## Kompatibilitás

- Minecraft Bedrock **1.26.20 vagy újabb** (min_engine_version; a felülírt `villager_v2` entitás-definíció ebből a verzióból származik — a gépeden 1.26.51 van).
- Script API: `@minecraft/server` **2.0.0**, `@minecraft/server-ui` **2.0.0** (stabil, nem béta).
- **Nem** kell semmilyen kísérleti (Experimental) kapcsoló.

## Telepítés

1. Dupla kattintás a `WaypointMonuments.mcaddon` fájlra — a Minecraft importálja mindkét csomagot.
2. A világ beállításainál add hozzá a **Waypoint Monuments [BP]** behavior packet (a resource pack vele jön).
3. Frissítéskor (korábbi verzióról): a világnál vedd le, majd add hozzá újra a BP-t, hogy az 1.7.0 legyen aktív.
   A korábban lerakott monumentek és neveik megmaradnak. (A régebbi verzióval lerakott monumenteknek nincs
   tulajdonosuk, ezért nem számítanak bele senki 5-ös keretébe — aki először jobbklikkel rájuk, az lesz a gazdájuk.)

## Recept (barkácsasztal)

```
    [óra]
  [iránytűkő]   ← lodestone
[kő] [kő] [kő]
```

## Használat

| Lépés | Mi történik |
|---|---|
| Lehelyezés | Csak játékos tudja regisztrálni; `/setblock`-kal lerakott példány inert marad. **Játékosonként legfeljebb 5** állhat egyszerre — a hatodiknál a lerakás nem történik meg, a blokk a kézben marad („You already have 5/5 waypoints"). Egy kibányászott monument felszabadít egy helyet. |
| Jobbklikk (első) | Névadó űrlap → a waypoint **aktív** lesz. |
| Aktivátor a monument **alá** | `redstone_block` → **Teleport Waypoint** (piros perem + piros szikrák), `lapis_block` → **Enchanting Waypoint** (kék, keringő halo), `diamond_block` → **Sanctuary Waypoint** (szándékosan láthatatlan: a monument alap kinézetű marad; ellenséges mobok 20 blokkon belülre nem jöhetnek — félmásodpercenként kifelé lökődnek). Eltávolítva → alap kinézet, a funkció azonnal leáll; visszatéve → újra működik. |
| Jobbklikk (aktív) | Mód szerinti menü: teleport-célok listája **csak más Teleport Waypointokra** (bármelyik dimenzióban — Overworld ↔ Nether ↔ End is) — **10 szint**/ugrás; vagy **Enchant held item** gomb — **50 szint**/enchantolás (csak akkor vonódik le, ha tényleg került rá valami); plusz átnevezés. Kreatívban ingyenes. |
| Sneak + jobbklikk | Nem nyit menüt (blokk lerakható a monument mellé). |
| Kibányászás | Csak gyémánt / netherit csákánnyal (≈1,5 s; mással 1 óra). A waypoint törlődik a hálózatból. Dugattyú nem mozdítja el, robbanás (obszidián-szint) nem töri. |

## Enchanting Waypoint — mi kerül a tárgyra

A kézben tartott tárgy típusa alapján a `scripts/config/enchantments.js` `ENCHANTMENT_CONFIG` táblája dönt.
A `|` jelölt párok egymást kizárják: ha a tárgyon már rajta van az egyik, azt tartja meg (és szintet emel),
különben **50–50 % véletlen**.

| Kategória | Enchantmentek |
|---|---|
| Helmet | Protection IV, Unbreaking III, Thorns III, Respiration III, Aqua Affinity, Mending |
| Chestplate | Protection IV, Unbreaking III, Thorns III, Mending, **Black Wings I** (saját enchant) |
| Leggings | Protection IV, Unbreaking III, Thorns III, Swift Sneak III, Mending |
| Boots | Protection IV, Unbreaking III, Thorns III, Feather Falling IV, Depth Strider III, Soul Speed III, Mending |
| Sword | Sharpness V **\|** Smite V; Looting III, Fire Aspect II, Knockback II, Unbreaking III, Mending (Sweeping Edge csak ha a verzió ismeri — Bedrockon nincs, kihagyja) |
| Mace | Density V **\|** Breach IV; Wind Burst II, Fire Aspect II, Unbreaking III, Mending |
| Pickaxe / Axe / Shovel / Hoe | Fortune III **\|** Silk Touch; Efficiency V, Unbreaking III, Mending |
| Trident | Riptide III **\|** (Loyalty III + Channeling); Impaling V, Unbreaking III, Mending |
| Bow | Infinity **\|** Mending; Power V, Punch II, Flame, Unbreaking III |
| Crossbow | Piercing IV **\|** Multishot; Quick Charge III, Unbreaking III, Mending |
| Fishing rod | Lure III, Luck of the Sea III, Unbreaking III, Mending |
| Egyéb (olló, pajzs, elytra…) | Unbreaking III, Mending, Efficiency V, Silk Touch — csak ami a tárgyra valóban rakható |

Szabályok:
- **Konfliktus-tábla** (`CONFLICTS`): Sharpness/Smite/Bane, Density/Breach/Smite/Bane, Fortune/Silk Touch, Riptide/Loyalty,
  Riptide/Channeling, Infinity/Mending, Piercing/Multishot, Depth Strider/Frost Walker, Protection-változatok.
  Meglévő, ütköző enchantmentet **soha nem ír felül**.
- Meglévő szint **soha nem csökken**; alacsonyabb szint a cél-szintre emelkedik (pl. Sharpness III → V).
- Ami már maximális, érintetlen marad. Ha semmi nem változott: „This item already has the maximum enchantments.”
- Ismeretlen / nem támogatott enchantment (pl. Sweeping Edge) és olyan, amit a tárgy nem fogad (`canAddEnchantment` = false) → csendben kimarad.
- Szintek a tényleges `maxLevel`-re vannak korlátozva.

Üzenetek: `Enchanting complete!` + lista · `No enchantable item in your hand.` ·
`An Enchanting Waypoint needs a Lapis Lazuli Block directly beneath it.` · `This item already has the maximum enchantments.` ·
`None of this waypoint's enchantments can be applied to that item.` (enchantolható, de egyik konfigurált enchantment sem illik rá) ·
`Enchanting failed — your item was left unchanged.` + piros hibasor (API-hiba esetén; a tárgy ilyenkor érintetlen marad).

## Világszintű játékmenet-szabályok (`scripts/gameplay.js` — `GAMEPLAY_CONFIG`)

| Szabály | Mit csinál | Beállítás |
|---|---|---|
| **Útblokk-sebesség** | Aki legalább **3 blokk széles** útblokk-úton (Dirt Path, `minecraft:grass_path`) jár, **Speed II**-t kap **2 mp-re**; amíg az úton marad, félmásodpercenként újraindul. Erősebb / hosszabb meglévő Speed-et nem ír felül. | `pathSpeed.thickness` (3), `pathSpeed.orientation`: `"horizontal"` = legalább 3 blokk **széles** útsáv X vagy Z irányban (alapértelmezés); `"vertical"` = 3 útblokk egymás alatt. |
| **Sanctuary** | Gyémánt blokk a monument alatt → 20 blokkos sugárban minden `monster` családú mob kifelé lökődik (minél beljebb, annál erősebben). Csak játékos által lerakott monumentnél. Nincs semmilyen vizuális jelzés — a menü „Mode: Sanctuary Waypoint" sora mutatja, hogy aktív. | `ward.radius`, `ward.minPush` / `maxPush` |
| **Waypoint-limit** | Játékosonként max. 5 egyszerre álló monument. | `waypointLimit.perPlayer` |
| **Mob-sebzés** | Ellenséges mob (közelharc, nyíl, robbanás) minden találata **+2 szív** (4 HP) extra sebzést okoz a játékosnak; ez páncéltól függetlenül, közvetlenül az életerőből megy le. Halálos esetben a mob kapja a kill-t. **A fantom kivétel: 0 HP.** | `mobBuffs.extraDamage` (4), `mobBuffs.playersOnly` |
| **Fantomharapás** | A fantom alap támadási sebzése **0 HP**. Játékos eltalálásakor **Weakness I, Slowness I és Nausea I** jár **5 másodpercre** (100 tick); csak a harapó fantom gyógyul **1 HP-t**, legfeljebb a maximális életerejéig. | `phantomBite` + `entities/phantom.json` |
| **Creeper** | A creeper-robbanás nem tör blokkot, csak sebez (a `mobGriefing` szabály érintetlen, a villagerek/endermanek működnek). | `explosions.noBlockDamageFrom` |
| **10× minecart** | A csille, a ládás és a tölcséres csille sebességplafonja **4 blokk/tick (80 m/s)** a vanilla 0,4 helyett (felülírt `entities/*minecart.json`). Mivel a powered rail vanilla gyorsulása gyenge, a script a **powered (bekapcsolt) arany sínen** álló kocsit tickenként ×1,25-tel gyorsítja a plafonig (~10 tick alatt éri el). Sima sínen a szokásos súrlódás fékez, ezért hosszú pályán időnként powered sín kell. | `minecart.maxSpeed` (a JSON-nal együtt), `minecart.boostPerTick` |

Az út szélességét a játékos blokkjától indulva X és Z irányban is nézi: ha bármelyik irányban van 3 egymás melletti útblokk, ami a játékos blokkját is tartalmazza, jár a sebesség. Egy- vagy kétblokkos ösvényen nem.

## Építész tervezőasztal — Vár és Katedrális (v1.7.0)

Az első belépéskor minden játékos kap egy **Építész tervezőasztalt** a kezébe. A korábban kézben tartott
tárgy biztonságosan a leltár egy szabad helyére kerül. További példány barkácsasztalon, tetszőleges elrendezésben
**könyv + papír + iránytű** recepttel készül; teszthez: `/give @s wp:building_planner`.
Tele leltárnál szabadíts fel egy helyet; a kézbesítés 5 másodpercenként újrapróbálkozik, tárgyat nem dob el.

1. Állj egy nagy, sík, üres terület elé, nézz a kívánt építési irányba, és tedd le az asztalt.
2. A megnyíló menüben válaszd a **Vár** (27 × 31 blokk, 25 blokk magas) vagy **Katedrális**
   (23 × 35 blokk, 32 blokk magas) lehetőséget. Az asztal használatával a menü újranyitható.
3. Az épület platformja 3 blokkal az asztal előtt kezdődik, a lerakáskor nézett legközelebbi égtáj irányában;
   a bejárat az asztal felé néz. Maradj az asztalnál, az alaprajzon kívül, amíg az épület elkészül.

A vár négy saroktornyot, pártázatos falat, udvart és lépcsővel elérhető emeletes lakótornyot kap.
A katedrálisnak két harangtornya, aranykeresztjei, színes ablakai, rózsaablaka, támpillérei, padsorai és oltára van.
Mindkettő belső világítással épül fel, több tickre elosztva.

Az egész területnek betöltöttnek kell lennie, összefüggő talajjal az alap alatt. A script építés előtt ellenőrzi
a teljes befoglaló teret: meglévő építmény vagy akadály esetén nem kezd bele. Csak levegőt és apró növényzetet
cserél; játékos nem állhat az építési területen. **Guggolás + használat az asztalon**, az asztal kibányászása,
kilépés, dimenzióváltás vagy 64 blokknál nagyobb eltávolodás megszakítja az építést és visszaállítja a saját
változtatásait. A visszaállítás közben mások által módosított blokkokat megőrzi. Egyszerre egy építés vagy
visszaállítás futhat. Az asztal újra használható és kiásva magaddal vihető; az építkezés nem fogyaszt anyagokat.

## Black Wings I — fekete szárnyak a mellvérten (v1.7.0)

Tarts egy mellvértet a kezedben, és enchantold egy lapis blokkal aktivált **Enchanting Waypointnál**.
A szokásos enchantok mellé **Black Wings I** kerül rá (a megszokott 50 szint költségével; kreatívban ingyen).
A már maximális vanilla enchantokkal rendelkező mellvért is megkaphatja; utána az ismételt enchant nem kerül XP-be.

A mellvértet felvéve a hátadon fekete, összecsukott elytraszárnyak jelennek meg, amelyek repüléskor kinyílnak.

| Irányítás | Működés |
|---|---|
| Gyors dupla ugrás (0,35 mp-en belül) | Repülés be- vagy kikapcsolása túlélő és kaland módban |
| Mozgásgombok / joystick | Mozgás a nézési irányhoz képest, legfeljebb 8,4 blokk/mp |
| Ugrás nyomva tartva | Emelkedés, 6 blokk/mp |
| Guggolás | Süllyedés, 6 blokk/mp |
| Gombok elengedése | Lebegés egy helyben |
| Mellvért levétele | Repülés és szárnyak megszűnnek |

Nem kell tűzijáték, ugrásindító tárgy vagy cheats. Kreatív módban a játék saját repülésvezérlése működik;
a szárnyak ahhoz igazodnak. Vízben, úszáskor, alváskor vagy járművön a saját repülés kikapcsol. Halál,
dimenzióváltás és waypoint-teleport után újra be kell kapcsolni. A repülést magasan kikapcsolva normálisan zuhansz.

**Bedrock-megvalósítás:** saját, scriptelt enchant, az eredeti mellvért dynamic property-jében és lore-jában tárolva;
az eredeti tárgy, páncélérték, tartósság, név, színezés, trim és vanilla enchantok megmaradnak. A `/enchant` parancs
nem ismeri ezt a saját enchantot. Egy szabad lore-sor szükséges (legfeljebb 20 sor lehet).
A stabil API nem ad új natív elytra-képességet a mellvérthez: a repülés kis lépésű, ütközést ellenőrző
pozícióváltásokkal utánozza a kreatív repülést, álló testtartással. A fekete szárnyakat külön, nem ütköző
kozmetikai entitás jeleníti meg. Nem változtat játékmódot vagy potion-effektet, így a Deep Sky időtartamát sem nyújtja.

## Village Guard — falusi őr NPC (`scripts/guards.js` — `GUARD_CONFIG`, `entities/wp_village_guard.json`)

Új entitás: `wp:village_guard`. Pillager kinézet (a vanilla geometria és textúra másolata), a **hátán zöld zászló**
rúdon, enyhén megdöntve. **Nem** a `monster` családba tartozik, így a falusiak és a Sanctuary Waypoint békén hagyják.

| Szabály | Részlet |
|---|---|
| **Spawn** | Ahol a játékos közelében (48 blokk) legalább **3 falusi** van, azt a script falunak tekinti, és egyszer feltölti őrökkel: **kb. 3 falusinként 1 őr, minimum 1, maximum 10**. A falut egy 64 blokkos rácscella azonosítja, így újralátogatáskor nem spawnol újra; elesett őrt viszont pótol. |
| **Harc** | Minden `monster` családú ellenfelet megtámad 24 blokkon belül, és visszaüt bárkinek, aki bántja (más őrnek nem). 26 életerő, fél knockback-ellenállás, gyorsabb a falusinál. A creeper nem vág vissza rájuk (felülírt `entities/creeper.json`), de a robbanás sebzi őket. |
| **Nem alszik** | Nincs napirendje és ágya, ezért éjjel-nappal járőrözik. |
| **Fletching table mellette** | 3 blokkon belül → **íjász** lesz: `minecraft:shooter` + `ranged_attack`, 15 blokkos lőtáv, íj a kezébe. |
| **Grindstone mellette** | 3 blokkon belül → **közelharcos**: 4–6 sebzés, vasfejsze a kezébe. Alapértelmezés (ha egyik blokk sincs a közelben) szintén közelharc. |
| **Hazatérés** | Ha 64 blokknál messzebb kerül a falu közepétől és épp nem harcol, a script visszateszi a faluba. |

A fegyver csak látvány: a viselkedések üres kézzel is működnek, tehát a `replaceitem` esetleges hibája nem töri el a harcot.

## The Deep Sky — zsebdimenzió (`scripts/deepsky.js` — `DEEPSKY_CONFIG`)

**Fontos technikai tény:** a Bedrock Edition nem támogat add-onból létrehozott, valódi új dimenziót. A Deep Sky ezért
**emulált**: a The End dimenzióban, a fő szigettől 100 000 blokkra, a magasban (Y≈190) él, ahol a The End természetéből
adódóan **soha nincs nappal**. A látogató sötét éjszakai ködöt kap (`fogs/deep_sky.json`), a világot pedig a script
generálja az első belépéskor (egyszer; utána a világba mentve marad).

| Elem | Részlet |
|---|---|
| **Belépés** | Idd meg a vanilla **Potion of Slow Falling**-ot (főzés: awkward potion + phantom membrane → 1:30; redstone-nal 4:00), majd jobbklikk egy **Teleport Waypoint**-ra: a menüben a cél-lista helyett egyetlen gomb, „✦ Rise into The Deep Sky" (10 szint). Bármilyen forrású Slow Falling jó (nyíl, `/effect`). |
| **Tartózkodás** | Ameddig a Slow Falling tart (aether-stílus: a szigetek közt lebegve leereszkedhetsz). Ha érkezéskor 30 mp-nél kevesebb van hátra, 30 mp-re egészül ki. Bent megivott újabb potion **meghosszabbítja** (a hosszabb időtartam érvényesül). |
| **Visszaút** | **Kizárólag** akkor, amikor a Slow Falling effekt eltűnik (lejár vagy pl. tej) → a script visszateleportál az indulási waypointhoz. Waypointot nem tudsz bent lerakni, a menük nem válaszolnak. Halál esetén normál respawn (a látogatás véget ér). |
| **Világ** | 7 lebegő sziget (deepslate-tiles / bricks, sculk-foltok, tuff-mag), 4 romos híd a központból. Központi „citadella": reinforced-deepslate keret soul fire-rel, 8 soul-lantern pillér, romfalak, sculk catalyst/sensor/shrieker, szürke gyapjú, kincsesláda. Torony-sziget, sculk-kert, rom, shrieker-szentély, plusz két alacsonyabb szigetecske (csak lesiklással érhető el, ládával). |
| **Szörnyek** | **Fantomok nincsenek a Deep Sky területén**: a korábbról megmaradt, újonnan megjelenő és később betöltődő példányokat is eltávolítja, minden magasságon. **Warden**: 5 mp-enként 0,8 % (≈ 10 percenként egy), a talajon a látogató közelében, max. 1. Endermanek (a The End természetes spawnja) a zónában azonnal eltűnnek. |
| **Nincs pihenés** | Ágy és respawn anchor használata a látogatónak tiltva („There is no rest in The Deep Sky.") — így a respawn-pont sem frissül, és az ágy sem robban fel. |
| **Lezuhanás** | Y<130 alá süllyedve a script visszaemel az érkezőpadra (a lassú esés miatt a mélybe zuhanás nem halálos, de kiesnél a világból). |

Beállítások: koordináták, zónaméret, minimum-idő, spawn-esélyek, potion-időtartam mind a `DEEPSKY_CONFIG`-ban.

## Falusiak — harag és szaporodás (`scripts/villagers.js` — `VILLAGER_CONFIG`, `entities/villager_v2.json`)

A vanilla `villager_v2` entitás-definíciót az addon **felülírja** (a telepített 1.26.51-es játék eredeti fájljából
készült, programozottan bővítve — az eredeti részek bájtra azonosak). A falusiak **nem harcolnak** — a falu védelme a Village Guard dolga. A felülírás csak 13 `wp:taxed_<szakma>` klón-csoportot
ad hozzá, amelyek az eredeti kereskedési tábla helyett a `trading/wp_taxed/` alatti, **+30 %-os** táblát használják, plusz
egy `wp_villager_plus` család-címkét: a script ebből látja, hogy a felülírás tényleg betöltődött — ha nem, piros üzenetet
ír a chatbe.

> **v1.6.1 — a falusi-harc kivéve.** A v1.4–1.6.0-ban a falusiak maguk védekeztek volna, de a felülírt entitást a
> játék két külön hibával is elutasította (először PowerShell `003c` escape-ek a napirend-szűrőkben, majd egy nem
> létező `reach_multiplier` mező a `melee_box_attack`-ban). A felhasználó döntése alapján a falusi-harc teljesen
> kikerült: a védelmet a Village Guard látja el, a falusiaknál csak a harag→áremelés és a szaporodás maradt. Tanulság a
> generátorban rögzítve: minden entitás-mező csak akkor kerülhet be, ha a vanilla fájlokban is szerepel.

| Szabály | Részlet |
|---|---|
| **Első ütés** | Bocsánatos: „The villager staggers back. Strike again and the village will remember it." 2 perc után felejtődik. |
| **Második ütés** | A falu megsértődik: a 24 blokkon belüli felnőtt falusiak (gyerekek nem) megjegyzik az esetet. **Nem támadnak** — csak a pénztárcádon állnak bosszút. Újabb ütés a 8 perc alatt újraindítja az órát és bevonja a további szomszédokat. |
| **8 perc után** | Lecsillapodnak („The villagers have calmed down…"), és a sértést látó falusiak kereskedése **30 %-kal drágább** lesz (a kért mennyiség ×1,3, felfelé kerekítve, max. 64). Végleges. Szakma nélküli falusi akkor kapja meg, amikor munkát vállal. |
| **Önálló szaporodás** | Aki **10 játékbeli napig** (200 perc) nem kapott sebzést (semmitől), az egy hasonlóan sértetlen, 8 blokkon belüli felnőttel **étel és ágy nélkül** is utódot hoz: percenként legfeljebb egy születés játékos-környezetenként, szülőnként 1 nap pihenő, 32 blokkon belül max. 12 falusi. |

Fontos következmény: az adó a kereskedési tábla cseréjével valósul meg (Bedrockban nincs ár-API), ezért a megsértett
falusi kereskedései **újrasorsolódnak** az adózott táblából — az addig kinyitott szintek elveszhetnek. Ez a Bedrock
egyetlen módja a tartós áremelésnek.

## Működés (technikai)

- A blokk `wp:mode` állapota (`none` / `teleport` / `enchant` / `ward`) vezérli a kinézetet (permutációk: piros `rim` material + erősebb fény; a `ward` szándékosan nem kap permutációt, alap kinézetű marad).
- A `minecraft:tick` komponens 10 tickenként (0,5 s) hívja a custom component `onTick`-jét **csak betöltött** monumenteken:
  ez szinkronizálja az állapotot az alatta lévő blokkal és szórja a részecskéket (csak ha 48 blokkon belül van játékos).
- Redstone/lapis lerakása vagy kibányászása eseményből azonnal frissíti a felette lévő monumentet (üzenet + hang);
  robbanás (`blockExplode`) és dugattyú (`pistonActivate`) esetén is esemény szinkronizál, a tick csak biztonsági háló.
- A registry world dynamic property-kben él, shardolva (`wp:waypoints/count` + `wp:waypoints/N`), így nincs 32 k bájtos
  plafon; memóriában cache-elve, és csak akkor íródik, ha ténylegesen változott valami. A korábbi (v1.0.x) egyblokkos
  registry automatikusan átmigrálódik.
- Menü megnyitásakor, teleportnál és enchantnál a mód **mindig élőben** újraolvasódik az alatta lévő blokkból.

## Fájlok

```
WaypointMonuments_BP/
  manifest.json
  blocks/waypoint.json               állapotok, permutációk, tick, immovable, custom component
  recipes/waypoint.json
  scripts/main.js                    belépési pont: registry, menü, teleport, enchant akció, waypoint-limit
  scripts/modes.js                   aktivátor → mód, blokkállapot szinkron, részecskék
  scripts/enchanting.js              enchant-motor (ItemEnchantableComponent)
  scripts/wing-enchantment.js        Black Wings I: dynamic property + lore az eredeti mellvérten
  scripts/black-wings.js             kreatív jellegű repülés, szárnyak követése és életciklusa
  scripts/buildings.js               tervezőasztal: tárgyadás, menü, ellenőrzés, építés, visszaállítás
  scripts/building-plans.js          Vár / Katedrális geometriája és égtáj szerinti elhelyezése
  scripts/gameplay.js                GAMEPLAY_CONFIG: útsebesség, sanctuary, mob-sebzés, creeper-szabály, XP-költségek
  scripts/deepsky.js                 DEEPSKY_CONFIG: zsebdimenzió (belépés/visszaút, szigetgenerálás, spawnok)
  scripts/villagers.js               VILLAGER_CONFIG: ütésszámlálás, harag, adó, önálló szaporodás
  scripts/guards.js                  GUARD_CONFIG: falu-felismerés, őr-spawn, fletching/grindstone mód, hazatérés
  entities/wp_village_guard.json     Village Guard entitás (wp:melee / wp:ranged csoportok)
  entities/villager_v2.json          felülírt vanilla falusi (+ őr/védekező és adózott csoportok, események)
  entities/creeper.json              felülírt vanilla creeper (nem vág vissza falusiaknak)
  entities/phantom.json              felülírt vanilla fantom, 0 támadási sebzés
  entities/black_wings.json          nem ütköző kozmetikai szárny-entitás
  entities/minecart.json, chest_minecart.json, hopper_minecart.json   rail_movement.max_speed = 4.0
  tools_build_entities.ps1, tools_vanilla/   generátor + vanilla források (nem kerülnek a csomagba)
  trading/wp_taxed/*.json            13 kereskedési tábla +30 %-kal
  scripts/config/enchantments.js     ENCHANTMENT_CONFIG, CONFLICTS, CATEGORY_RULES
WaypointMonuments_RP/
  manifest.json, blocks.json, texts/
  fogs/deep_sky.json                  éjszakai köd a Deep Sky látogatóinak
  entity/wp_village_guard.entity.json, models/entity/wp_village_guard.geo.json,
  render_controllers/wp_village_guard.render_controllers.json, textures/entity/wp_village_guard.png
  models/blocks/wp_waypoint.geo.json  obeliszk + "rim" talapzat
  textures/blocks/wp_waypoint.png, wp_waypoint_rim_red.png
  textures/particle/wp_glow.png
  particles/wp_lapis_halo.json, wp_redstone_spark.json
```

## Tesztelési útmutató

Túlélő vagy kreatív világban, a BP aktiválva. A `/give` parancsok kreatívban / cheatekkel a leggyorsabbak (megjegyzés:
a cheatek bekapcsolása véglegesen letiltja az achievementeket az adott világon — tesztvilágot használj).

1. **Lapis nélkül**: aktivált waypoint, jobbklikk → „Dormant” menü, nincs Enchant gomb.
2. **Lapissal**: `lapis_block` a monument alá → kék halo kering, chat: „Enchanting Waypoint activated”, menüben Enchant gomb.
3. **Üres kéz**: Enchant → „No enchantable item in your hand.”
4. **Diamond Sword**: Enchant → Sharpness V *vagy* Smite V + Looting III, Fire Aspect II, Knockback II, Unbreaking III, Mending.
5. **Netherite Sword**: ugyanaz; több próbával mindkét Sharpness/Smite variáns előfordul.
6. **Pickaxe (Fortune)**: friss csákány, ismételd, míg Fortune III jön: Efficiency V, Fortune III, Unbreaking III, Mending, Silk Touch NINCS.
7. **Pickaxe (Silk Touch)**: mint fent, Silk Touch-os változat, Fortune NINCS.
8. **Bow (Infinity)**: Power V, Punch II, Flame, Unbreaking III, Infinity — Mending NINCS.
9. **Bow (Mending)**: ugyanaz Mendinggel, Infinity NINCS.
10. **Crossbow (Piercing)**: Piercing IV, Quick Charge III, Unbreaking III, Mending.
11. **Crossbow (Multishot)**: Multishot, Quick Charge III, Unbreaking III, Mending.
12. **Trident (Riptide)**: Riptide III, Impaling V, Unbreaking III, Mending — Loyalty/Channeling NINCS.
13. **Trident (Loyalty + Channeling)**: Loyalty III, Channeling, Impaling V, Unbreaking III, Mending — Riptide NINCS.
14. **Helmet**: Protection IV, Unbreaking III, Thorns III, Respiration III, Aqua Affinity, Mending.
15. **Chestplate**: Protection IV, Unbreaking III, Thorns III, Mending, Black Wings I.
16. **Leggings**: Protection IV, Unbreaking III, Thorns III, Swift Sneak III, Mending.
17. **Boots**: Protection IV, Unbreaking III, Thorns III, Feather Falling IV, Depth Strider III, Soul Speed III, Mending.
18. **Már enchantolt item**: `/enchant @s sharpness 3` egy kardra → Enchant → „Sharpness III → Sharpness V”, a többi hozzáadva.
19. **Max szint**: ismételt Enchant ugyanazon a tárgyon → „This item already has the maximum enchantments.”
20. **Inkompatibilis**: `/enchant @s smite 5` kardra → Enchant → Smite marad, Sharpness NEM kerül rá; bow + `/enchant @s infinity 1` → Mending NEM kerül rá.
21. **Lapis eltávolítása**: bányászd ki a lapist → halo eltűnik, chat: „Enchanting Waypoint deactivated”, Enchant gomb eltűnik / „needs a Lapis Lazuli Block” üzenet.
22. **Lapis visszahelyezése**: halo és Enchant gomb visszatér.

Teleport-mód: 23. redstone két aktivált monument alá → mindkettőn piros perem + szikrák, a menü listázza a másikat, teleport működik.
24. Redstone kivétele a cél alól → a cél eltűnik a listából; ha még listázva volt: „has no Redstone Block beneath it”.
25. Redstone kivétele a forrás alól → a menü „Dormant”, nincs cél-lista.

v1.2.0 játékmenet-szabályok:
26. **Dimenzióváltás**: Teleport Waypoint az Overworldben és egy a Netherben → mindkettő listázza a másikat, a teleport átvisz.
27. **Waypoint-limit**: rakj le 5 monumentet (a chat számol: „placed (1/5)" … „(5/5)"); a hatodik lerakása nem történik meg, piros üzenet, a blokk a kézben marad. Bányássz ki egyet → a következő lerakás újra sikerül.
28. **Útblokk (3 széles)**: építs egy 3 blokk széles útblokk-sávot (ásóval földön/füvön) → rálépve Speed II ikon jelenik meg és nem jár le, amíg az úton maradsz; lelépve ~2 mp múlva eltűnik. 1–2 blokk széles ösvényen NINCS hatás.
29. **Sanctuary**: gyémánt blokk egy lerakott monument alá → a monument kinézete NEM változik, a menüben „Mode: Sanctuary Waypoint"; egy zombi 20 blokkon belül kifelé lökődik, közelebb nem jut. Gyémánt kivétele → a mobok bejöhetnek.
30. **Mob-sebzés**: 20 HP-nál egy zombi-ütés (túlélő, normál nehézség ≈ 3 HP) után kb. 13 HP marad (3 + 4 extra); csontváz nyila és creeper-robbanás ugyanígy +4. Játékos-játékos vagy állat-sebzés változatlan.
31. **Creeper**: felrobbanó creeper sebez, de a talaj érintetlen; TNT és ghast továbbra is rombol.

v1.3.x — költségek és The Deep Sky:
32. **Teleport-költség**: 9 szinttel a teleport-gomb „Teleporting costs 10 levels — you have 9"; 12 szinttel átvisz, 2 marad. Kreatívban nincs levonás.
33. **Enchant-költség**: 49 szinttel elutasít; 50+ szinttel enchantol és 50-et levon. Már maxos tárgynál („already has the maximum") NEM von le.
34. **Potion**: főzz Slow Falling potiont (awkward + phantom membrane; redstone-nal 4 perces), idd meg → Slow Falling a HUD-on.
35. **Belépés**: Slow Falling alatt jobbklikk egy Teleport Waypointra → „✦ Rise into The Deep Sky" gomb (a normál cél-lista helyett) → sötét, ködös lebegő szigetek a The Endben; cím: „The Deep Sky — There is no dawn here."
36. **Világgenerálás**: az első belépésnél 1–3 mp alatt felépül a talpad alatti pad, majd a szigetek; második belépéskor már kész. (Content Log-ban `[Waypoint] Deep Sky: could not place …` sor jelezné, ha egy blokk-azonosító nem létezne.)
37. **Phantomok**: egy sem jelenik meg a Deep Skyban; a korábbról megmaradtak is eltűnnek, akár később betöltődő chunkból. **Warden**: továbbra is ritka — `/effect @s slow_falling 900`-zal adott hosszú effekt után ~10 perc alatt várható egy.
38. **Nincs pihenés**: ágy lerakása és jobbklikk → „There is no rest in The Deep Sky.", nem robban, spawn-pont nem változik.
39. **Hosszabbítás**: bent megivott újabb Slow Falling potion → az effekt ideje meghosszabbodik, a látogatás folytatódik.
40. **Visszaút**: `/effect @s clear` (vagy tej, vagy lejárat) → azonnal visszakerülsz az indulási waypointhoz („The potion fades — you are pulled back to …"), a köd eltűnik.
41. **Waypoint bent**: monument lerakása a zónában → „No monument can take root in The Deep Sky.", a blokk a kézben marad.

v1.4.0 — falusiak:
42. **Első ütés**: üss meg egy falusit → sárga figyelmeztetés, nem támad. Várj 2 percet, üss újra → megint csak figyelmeztetés (elfelejtette).
43. **Második ütés**: 2 percen belül másodszor → „The villagers turn away from you. N of them saw it…" — NEM támadnak, csak megjegyzik.
44. **8 perc**: lejárta után „The villagers have calmed down…" üzenet.
45. **Adó**: a sértést látó falusi kereskedését megnyitva az árak ~30 %-kal magasabbak (pl. 1 emerald → 2, 7 → 10, 15 coal → 20), a lista újrasorsolt. Aki nem vett részt (távoli falusi), változatlan.
46. **Szaporodás**: teszthez a `VILLAGER_CONFIG.breeding.undamagedTicks`-t írd át pl. 1200-ra (1 perc): két sértetlen felnőtt 8 blokkon belül → szív-részecske, „mob.villager.yes", és egy gyerek falusi jelenik meg; ugyanaz a pár 1 napig nem szül újra. Üss meg egyet → az ő órája nulláról indul.


49. **Creeper vs falusi**: engedj egy creepert egy falusi mellé (a játékos maradjon ≥16 blokkra): a falusi üti, a creeper nem sistereg és nem fordul felé, végül meghal. Ha te is odamész 2,5 blokkon belülre, a creeper feléd sistereg és robban.

v1.5.0 — minecart:
50. **10× csille**: építs ~30 blokk egyenes sínt, az elején 3–4 powered arany sín (redstone fáklyával). Ülj a csillébe → a powered szakaszon fél másodperc alatt „elrepül" (80 m/s ≈ tizedmásodpercenként 8 blokk). Sima sínen fokozatosan lassul; kanyarban ellenőrizd, hogy nem ugrik-e le a sínről — ha igen, a `minecart.maxSpeed`-et és a JSON `max_speed`-et vedd 2.0-ra (5×).

v1.6.0 — Village Guard:
51. **Spawn**: menj egy faluba (legalább 3 falusi 48 blokkon belül), várj ~10 mp-et → 1–10 pillager-kinézetű őr jelenik meg, hátukon zöld zászlóval. Hagyd el és térj vissza: NEM spawnol újra. Ölj meg egyet → a következő ellenőrzéskor pótlódik.
52. **Harc**: éjjel a közeledő zombikat/csontvázakat megtámadják; a falusiakat nem bántják, és a falusiak sem őket. Sanctuary Waypoint (gyémánt) nem lökdösi őket.
53. **Fletching table**: tegyél egy fletching table-t egy őr mellé (3 blokkon belül) → 5 mp-en belül íj kerül a kezébe, és távolról nyilaz.
54. **Grindstone**: tegyél mellé köszörűkövet (és vedd el a fletching table-t) → vasfejszét kap és közelharcra vált.
55. **Éjszaka**: éjfélkor is ébren járőröznek, nem keresnek ágyat.

v1.7.0 — fantom, építkezés és fekete szárnyak:
56. **Harapás a Deep Skyon kívül**: túlélő módban, páncél nélkül engedd, hogy egy fantom megmarjon.
    Életerő nem csökkenhet; Weakness I, Slowness I és Nausea jelenjen meg 5 másodpercre. Egy sérült fantom
    harapásonként 1 HP-t gyógyuljon, egy másik fantom ne gyógyuljon vele. Ezt az engine-ben is ellenőrizd:
    az automatizált teszt az eseménykezelőt vizsgálja, a 0 sebzéses találati eseményt nem szimulálja a játék motorja.
57. **Építkezés**: új belépő kezébe kerül a tervezőasztal. Próbáld ki mindkét épületet külön sík, szabad területen,
    mind a négy égtáj felé nézve. A bejárat az asztal felé nézzen; akadálynál ne legyen változtatás.
    Építés közben guggolás + használat vagy az asztal kibányászása állítsa vissza a félkész épületet.
58. **Black Wings I**: enchantolj egy mellvértet lapis waypointnál, vedd fel, nézd meg harmadik személyben.
    Túlélőben dupla ugrás indítsa a repülést, mozgás irányítson, ugrás emeljen, guggolás süllyesszen;
    elengedett gomboknál maradj egy helyben. Falon ne tudj átrepülni. Levételkor tűnjenek el a szárnyak.
    Már maximális mellvértnél csak az új enchant kerüljön rá; második próbánál ne vonjon XP-t.

## Fejlesztői ellenőrzés és csomagolás

PowerShellből, a projekt mappájában, Node.js-szel:

```powershell
node tools/validate-addon.cjs
node --experimental-vm-modules tools/test-phantoms.cjs
node --experimental-vm-modules tools/test-wings.cjs
node --test tests/buildings.test.mjs
./tools_build_addon.ps1
```

A `--experimental-vm-modules` kizárólag a Node tesztfuttatóhoz kell; Minecraft-kísérleti kapcsolót nem igényel.
A tesztek API-másolatokkal futnak. A csomagoló ellenőrzi a JSON-t, a JavaScript szintaxisát, a fájlhivatkozásokat
és a manifest-verziókat, majd újraépíti a `WaypointMonuments.mcaddon` fájlt. A ZIP minden bejegyzését
SHA-256-tal összeveti a forrásfájllal. Csak a BP/RP kerül a csomagba. Import után a fenti játékbeli próbák szükségesek.

## Ismert korlátok

- Nem betöltött chunkban lévő cél waypointnál az utoljára ismert mód alapján dönt; érkezés után ellenőriz és frissít.
- A Sanctuary lökésre épül: lökés-ellenálló mobokat (Warden, Ravager) csak gyengén tart távol.
- A `villager_v2` felülírás miatt a Mojang jövőbeli falusi-változtatásai (új kereskedések, viselkedések) nem jelennek meg,
  amíg az addon aktív — frissítéskor az `entities/villager_v2.json`-t újra kell generálni az aktuális vanilla fájlból.
- A Deep Sky a The End-ben van: messze lent (Y≈60) a The End természetes külső szigetei látszhatnak; a látogató oda
  nem juthat le (Y<130 alatt visszaemeli a script). A szigetek első felépítéséhez a látogatónak az érkezőpad közelében
  kell maradnia pár másodpercig (a szimulációs távolságon belül épül).
- Az extra mob-sebzés közvetlenül az életerőt csökkenti, ezért a páncél és az Absorption (aranyalma) nem fogja fel.
- A fantom felülírása az aktuális vanilla viselkedést tartalmazza, 0 támadási sebzéssel; jövőbeli Minecraft-frissítéskor
  a forrást érdemes újra kinyerni, akárcsak a falusikét. A Deep Skyon kívüli fantomok megmaradnak.
- A félkész építkezés visszaállítási listája memóriában van: világbezárás vagy szerverleállás közben nem marad meg.
  Az építés/visszaállítás végét várd meg. A játék világát el nem mentett adatokhoz a kiegészítő nem tud hozzáférni.
- A Black Wings scriptelt repülésének és szárnykövetésének simasága függ a szerver teljesítményétől és a hálózati késéstől.
- A blokk-definíció `format_version` 1.21.100 (a `minecraft:movable` és az `item_specific_speeds` ezt igényli). Ha a
  gyémánt/netherit csákányos bányászás mégis órákig tartana, jelezd — akkor a csákány-szűrést más módon kell megoldani.
