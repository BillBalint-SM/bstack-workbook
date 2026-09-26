# Források és licencek

A BontaFlowStack Windows/Codex plugin munkafolyamatai a
[garrytan/gstack](https://github.com/garrytan/gstack) projektből származnak.
A rögzített viselkedési alap `71f6048e8ada25180e61438abc1d98cb151fe9a7`;
a Windows/Codex port helyi forrásrevíziója
`5fcee0c4e7913ce5ace55ad450aab4ae20482f4b`. Az átvett fájlok
forrás- és célhash-e a `workflow-adoption.json`, `common-adoption.json`,
`browser-adoption.json` és `helper-adoption.json` nyilvántartásban található.

Négy közös segéd helyi forrása a
[BillBalint-SM/bontaflowstack-workbook](https://github.com/BillBalint-SM/bontaflowstack-workbook)
`349cad6e655479baee84012131d2a34a4849f46b` helyi referenciája.
A `helper-adoption.json` őrzi az eredeti fájlutakat és SHA-256 értékeket.
A helyi revízióazonosító nem állítás arról, hogy a commit elérhető a távoli
GitHub-repóban.

A csomag az MIT licencet és a származtatott design-anyagokhoz tartozó
Apache-2.0 licencet a `plugins/bontaflowstack/licenses` mappában tartja.
Az `upstream-NOTICE.md` az eredeti forrás történeti útvonalait is felsorolja;
ez nem jelenti az összes ott említett fájl csomagolását.

A plugin működési neve `bontaflowstack` és `bfstack`. A nyilvántartások
`source` mezőiben megőrzött régi fájlnevek kizárólag a származást jelölik;
a futó kód a `destination` útvonalakat használja.
