# bstack MVP – megvalósítási terv

**Állapot:** tervezési alap. A jelenlegi nyilvános repó korábbi prototípust
tartalmaz; az új, önálló megvalósítás külön helyi munkapéldányban készül.
Ez a dokumentum követelményeket és lezárási kapukat rögzít; nem igazolja a
funkciók elkészültét vagy a kiadhatóságot.

## Cél és határ

A `bstack-workbook` repóból egy másik felhasználó friss letöltéssel telepíteni és
használni tudja az önállóan megírt bstack plugint natív Windows x64 rendszeren,
a kiadáskor natívan tesztelt stabil Codex-verzióval. Az MVP más operációs
rendszert, architektúrát vagy agentet nem támogat. A korábbi megoldások
Windows/Codex alatt használható funkciói és forgatókönyvei a működési
referenciák; a jobb Codex-kimenet a megjelenítési referencia. Az új kód és
skillszöveg saját megvalósítás. A kiadott forrás, csomag, dokumentáció,
azonosítók és felhasználói kimenetek kizárólag bstack neveket használnak.

A fejlesztés verziójelölése `0.1.0`. Az `1.0.0` csak az összes vállalt MVP-tétel
sikeres, egyben végzett elfogadása után adható ki. A Mac, Linux, iPhone és más
agentek történeti funkcióit a teljesség érdekében leltározni kell, de azok nem
részei ennek a kiadásnak, és hozzájuk most nem készül portolási terv.

## 1. Referencia és hatáskör rögzítése

- Az összehasonlításhoz használt korábbi állapotokat pontos revízióval kell
  rögzíteni a helyi auditbizonyítékban. A kiadott termék nem tartalmaz korábbi
  forrást, skillszöveget, termékazonosítót vagy működési függőséget.
- A referencia alapján minden tételről el kell dönteni, hogy teljesen vállalt
  Windows/Codex működés, csak részben ide tartozó működés vagy MVP-n kívüli
  funkció. A részben ide tartozó tételeknél az egyes ágakat kell besorolni.

**Lezárás:** az összehasonlítás alapja megismételhető, és egyetlen tétel sem
marad hatáskör szerinti besorolás nélkül.

## 2. Teljes funkcióleltár

A [FEATURES.md](FEATURES.md) jelenlegi névlistája csak kiindulópont. A leltárnak
ki kell terjednie az összes korábbi skillre, annak külön forgatókönyveire,
közös szabályaira, hookjaira, böngészős és dokumentumkészítő képességeire,
állapotkezelésére és szükséges segédműveleteire. Minden tétel kapjon stabil
azonosítót, hatáskört, indító feltételt, célt, fázisokat, elágazásokat,
felhasználói döntéseket, kimenetet, mellékhatásokat, hibautat és helyreállítást.

**Lezárás:** minden referenciaelemhez van tételes besorolás; a név- vagy
skilldarabszám önmagában nem számít teljességi bizonyítéknak.

## 3. Függőségek, határok és a „kész” definíciója

Készüljön egy részletes, tételenként ellenőrizhető függőség- és határdokumentum.
Sorolja fel a telepítési, build- és futtatási feltételeket, a szükséges
Codex-képességeket és verziót, Windows-eszközöket, jogosultságokat, hitelesítést,
külső szolgáltatásokat, tesztcélokat és esetleges költségeket. Különítse el a
mindenkire és a csak adott funkcióra vonatkozó feltételeket. Rögzítse az
ellenőrzési módot, a hiány esetén megjelenő állapotot és az adott tétel
elfogadási bizonyítékát.

A cél az egyszerű, lehetőleg további telepítendő függőségek nélküli használat.
Valós követelményt nem szabad elrejteni csak azért, hogy a függőséglista üres
legyen. Jelenleg nincs minden külső forgatókönyvhöz tesztcél vagy keret; az
ilyenek nem kaphatnak `PASS` minősítést tényleges próba nélkül.

**Lezárás:** még az adott funkció megvalósítása előtt látszik, mivel és hogyan
lehet bizonyítani a működését, és mi akadályozná a kiadást.

## 4. Közös működési szabályok

Minden skillre érvényes szerződésként rögzíteni kell a felhasználó nyelvéhez
igazodó, jól formázott, érthető és helyesírási hibáktól mentes kimenetet;
a tényleges cselekvések és a közölt eredmény egyezését; az emberi döntési
pontokat; az olvasás, írás és külső műveletek határát; az állapot elkülönítését;
a hiba, megszakítás és folytatás kezelését. Kötelező választ nem lehet
szimulálni vagy időzítővel helyettesíteni. Hiányzó előfeltétel vagy sikertelen
lépés nem jelenhet meg sikeresként. A szöveg szó szerinti azonossága nem
elvárás; a kötelező tartalom, döntés és eredményállapot igen.

**Lezárás:** minden közös szabály hozzárendelhető az érintett munkafolyamathoz
és ellenőrizhető felhasználói helyzetben.

## 5. Egyedi munkafolyamatok

Minden vállalt skillhez le kell írni, hogy meghívásakor mit indít a Codex:
belépés, lépéssorrend, ágak, kérdések, eszközhasználat, állapotváltozás,
kimenet, mellékhatás, hiba és helyreállítás. Az eredeti működés tartalmi
értékét és a korábbi bstack port jobb Codex-formázását új, saját
megvalósításban kell egyesíteni. Minden vállalt forgatókönyvhöz legyen
elfogadási eset; minden tudatos működésbeli eltérés kiadás előtti döntést kér.

**Lezárás:** minden vállalt leltártétel egy bstack-munkafolyamathoz és annak
ellenőrzéséhez kapcsolódik; nincs csak névvel képviselt funkció.

## 6. Plugin alap és implementáció

A plugin alapja a Codex által felismerhető és telepíthető csomagszerkezet:
manifest, skillek és a valóban szükséges futtatási elemek. A leltár és a
függőségdokumentum közötti megfeleltetés **követelménykövetési térkép**,
nem maga a plugin alapja. Erre épülnek a közös működési elemek, majd az egyes
skillek saját kóddal és szöveggel. Segédprogram csak igazolt közös igényhez
készüljön. Fejlesztés közben az érintett változáshoz célzott ellenőrzés kell;
a fő minősítést a végső egyben végzett elfogadás adja.

**Lezárás:** minden vállalt forgatókönyv megvalósult, és a futás nem függ
korábbi telepítéstől, a szerző gépétől vagy a fejlesztői checkouttól.

## 7. Csomag és felhasználói dokumentáció

A `bstack-workbook` tartalmazza az egyszerű telepítési és konfigurálási,
valamint az eltávolítási lépéseket. A README legyen a belépő; a használati
és funkcionális dokumentáció mutassa be a skilleket, előfeltételeiket,
eredményüket és korlátaikat. Az utasítások egy új felhasználó számára is
végrehajthatók legyenek személyes útvonalak vagy előzetes bstack-telepítés
nélkül. A csomag és az útmutató ugyanazt a `0.1.0` kiadásjelöltet írja le.

**Lezárás:** a dokumentált folyamat egy tiszta Windows/Codex környezetben,
friss GitHub-letöltésből követhető, beleértve az eltávolítást.

## 8. Egyben végzett elfogadás

A fő QA egy GitHubról frissen letöltött kiadásjelölt natív Windows x64 és
Codex-próbája, elkülönített tesztkörnyezetben. Egyben ellenőrzi a telepítést,
a skillek felismerését, minden vállalt forgatókönyv normál és hibás ágát,
a szükséges valódi felhasználói döntéseket, a mellékhatásokat, a kimenet
nyelvét és minőségét, majd az eltávolítást. Az eredmény tételenként `PASS`,
`FAIL` vagy `BLOCKED`, konkrét bizonyítékkal. `BLOCKED` vagy kihagyott
vállalt eset nem siker. Hiba javítása után az érintett ellenőrzés és az új
kiadásjelölt teljes elfogadása szükséges.

**Lezárás:** minden vállalt MVP-tétel `PASS`; a tesztelt Windows-, Codex- és
csomagverzió rögzített, az összes elfogadási bizonyíték áttekinthető.

## 9. Verzióemelés és publikálás

A fejlesztés `0.x.x` verzión marad, amíg a 8. pont teljes lezárása nem teljesül.
Csak ekkor lehet `1.0.0` verziót és kész Windows/Codex kiadást állítani.
A jelenlegi nyilvános célrepo korábbi commitjai örökölt tartalmat őriznek.
Egy tiszta új aktuális kiadás nem tünteti el bizonyíthatóan a már nyilvánossá
vált Git-történetet. Kiadás előtt külön rögzíteni kell, hogy a kizárólag bstack
azonosítókra vonatkozó követelmény az aktuális kiadási tartalomra vagy a teljes
elérhető történetre is érvényes; utóbbi a jelenlegi repóval nem garantálható.

**Lezárás:** a publikált verzió állításai megfelelnek az elfogadási
bizonyítékoknak, és a történeti tartalom kérdése rendezett.

## Jelenlegi állapot

Az önálló implementáció külön helyi munkapéldányában pluginváz, egy
`investigate`-skill tervezet és feladathoz kötött futási napló található.
Ezek teljes működési megfelelősége nincs bizonyítva.
A teljes forgatókönyvleltár, függőség- és határdokumentum, egyedi
munkafolyamatok és a GitHubról végzett teljes elfogadás még hátravan.
