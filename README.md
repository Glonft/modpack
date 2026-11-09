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

## Pliki

- `pack/pack.json`: wersja MC i NeoForge (musi zgadzać się z serwerem).
- `pack/external.json`: mody z CurseForge (generowane skryptem).
- `pack/mods/`: tu wrzucasz jary, których nie ma na CurseForge (np. własne mody klienta).
- `pack/config/`: opcjonalnie konfigi, które ma mieć każdy gracz.
- `keepUserChanges` w `pack.json`: pliki pobierane tylko raz, potem gracz może je zmieniać.
