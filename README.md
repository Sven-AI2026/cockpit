# cockpit für Claude Code

Ein Mod für Claude Code, der dir über dem Eingabefeld zeigt, was ein Chat kostet und wie viel Luft du noch hast. Dazu nimmt er dir die drei Handgriffe ab, die am meisten sparen:

1. **Cache warm halten, bis zu 12 Stunden, mit einem Klick.** Meeting, Mittagspause, Feierabend: Dein Chat bleibt im Cache, und die nächste Nachricht kostet deutlich weniger vom Limit, statt den ganzen Verlauf neu zu bezahlen.
2. **Den Chat verdichten, mit einem Klick.** Compact fasst den Verlauf zusammen, sobald der Kontext eng wird, und zeigt dir danach, wie viel Platz du zurückgewonnen hast.
3. **Dein Budget auf einen Blick.** Kontext, Fünf-Stunden-Limit und Wochenlimit, jeweils mit der Uhrzeit, zu der es wieder frei wird. Gelb und Rot warnen dich, bevor es knapp wird.

So sieht das aus:

```
▾  Cache (1 h) 56 min  ■■■■■■■■■■■■■■■■■■□□  ·  Hit 100 %  [Warmhalten]
   🟢 Kontext 22 % / Compact bei 97 %  ·  5h 26 % (frei 22:00)  ·  Woche 30 % (frei Do 12:00)   [Compact]
```

## Im Detail

- **Cache:** wie lange der Prompt-Cache noch warm ist, als Minuten und Balken. Ist der Cache warm, kostet die nächste Nachricht deutlich weniger vom Limit. Der Mod erkennt selbst, ob der Cache 5 Minuten oder 1 Stunde hält.
- **Hit:** wie viel der letzten Anfrage aus dem Cache kam.
- **Kontext:** wie voll der Chat ist, mit Ampel je nach Abstand zum automatischen Compact: 🟢 bis zur Hälfte der Schwelle, 🟠 bis 80 % der Schwelle, darüber 🔴.
- **5h und Woche:** wie viel vom Fünf-Stunden-Limit und vom Wochenlimit verbraucht ist und wann es wieder frei wird. Ab 70 % gelb, ab 90 % rot.
- **Warmhalten:** Der Knopf öffnet ein Stundenfeld (vorbelegt 3, höchstens 12). Kurz bevor der Cache abläuft, schickt der Mod eine Mini-Nachricht, auf die Claude nur „warm“ antwortet. Im Chat steht davon nur eine graue Zeile „Cache warm gehalten“. Ab 90 % beim 5h-Limit stoppt er von selbst. Alternativ: `/warmhalten 5` oder `/warmhalten aus`.
- **Compact:** startet `/compact` und schreibt danach Tokens vorher und nachher plus die Zusammenfassung in den Chat.
- **/handoff:** Claude schreibt eine Übergabe mit Ziel, Erledigt, Offen und nächstem Schritt. Danach erscheint der Knopf „Übergabe kopieren“ zum Einfügen in einen neuen Chat.
- **▾/▸** klappt alles auf eine kurze Zeile zusammen.

Braucht eine aktuelle Claude-Code-Version mit Mod-Unterstützung.

## Installation

Im Terminal in einer Claude-Code-Sitzung:

```
/plugin install cockpit --marketplace Sven-AI2026/cockpit
```

Die Frage „Add marketplace?“ mit `y` beantworten, dann den Bereich „user“ mit Enter wählen.

Aus der Shell:

```bash
claude plugin marketplace add Sven-AI2026/cockpit
claude plugin install cockpit@cockpit-mod --scope user
```

In der Desktop-App: auf + neben dem Eingabefeld klicken, dann Plugins, „Add marketplace“ mit `Sven-AI2026/cockpit`, dann „Add plugin“.

Danach einen neuen Chat starten.
