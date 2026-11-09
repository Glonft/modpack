# MelinaSMP – paczka modów

Lista modów, którą launcher ([Glonft/launcher](https://github.com/Glonft/launcher))
synchronizuje przy każdym kliknięciu **GRAJ**.

Mody **nie są** trzymane w tym repo. `pack/external.json` zawiera oficjalne linki
CurseForge i hashe SHA-1, więc gracze pobierają pliki bezpośrednio od autorów.

Po każdym pushu na `main` GitHub Actions publikuje
`https://glonft.github.io/modpack/manifest.json`.

## Jak zmienić mody

1. Dodaj, usuń lub zaktualizuj mody w instancji **MelinaSMP** w CurseForge i sprawdź, czy gra działa.
2. Wygeneruj listę na nowo:
   ```
   node tools/import-curseforge.js "C:\Users\damia\curseforge\minecraft\Instances\MelinaSMP"
   ```
3. `git add -A && git commit -m "Aktualizacja modów" && git push`

Gracze dostaną zmiany przy następnym uruchomieniu launchera. Stare mody launcher usunie sam.

Pamiętaj, żeby te same mody (te potrzebne serwerowi) wrzucić też na serwer IceHost.

## Zmiana adresu serwera

W `pack/pack.json` zmień `server.host` i/lub `server.port`, potem zrób commit i push.
Launchery (od wersji 0.3.0) wezmą nowy adres przy następnym kliknięciu GRAJ.

## Nowa wersja Minecrafta / NeoForge

1. Najpierw sprawdź, czy wszystkie ważne mody mają wersję na nowe MC.
2. Zrób nową instancję w CurseForge z nowym MC + NeoForge, dodaj mody, przetestuj.
3. W `pack/pack.json` ustaw:
   - `minecraft`, np. `"1.21.4"`,
   - `loader.version`, czyli wersję NeoForge z nowej instancji,
   - `java`, czyli wersję Javy wymaganą przez to MC (1.20.5–1.21.x: 21).
4. Wygeneruj listę modów z NOWEJ instancji (`tools/import-curseforge.js`), potem commit i push.
5. Na serwerze IceHost zmień wersję na tę samą i wgraj te same mody.

Launcher sam doinstaluje nowe NeoForge i Javę. Światy singleplayer, ustawienia i zrzuty ekranu graczy zostaną.

## Pliki

- `pack/pack.json`: adres serwera, wersja MC, NeoForge i Javy (musi zgadzać się z serwerem).
- `pack/external.json`: mody z CurseForge (generowane skryptem).
- `pack/mods/`: tu wrzucasz jary, których nie ma na CurseForge (np. własne mody klienta).
- `pack/config/`: opcjonalnie konfigi, które ma mieć każdy gracz.
- `keepUserChanges` w `pack.json`: pliki pobierane tylko raz, potem gracz może je zmieniać.
