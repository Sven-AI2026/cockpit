# cockpit für Claude Code

Ein Mod für Claude Code. Er zeigt über dem Eingabefeld zwei Zeilen mit allem, was du zu Kosten und Grenzen eines Chats wissen musst:

```
▾  Cache (1 h) 56 min  ■■■■■■■■■■■■■■■■■■□□  ·  Hit 100 %  [Warmhalten]
   ☀️ Kontext 22 % / Compact bei 97 %  ·  5h 26 % (frei 22:00)  ·  Woche 30 % (frei Do 12:00)   [Compact]
```

- **Cache:** wie lange der Prompt-Cache noch warm ist, als Minuten und Balken. Ist der Cache warm, kostet die nächste Nachricht deutlich weniger vom Limit. Der Mod erkennt selbst, ob der Cache 5 Minuten oder 1 Stunde hält.
- **Hit:** wie viel der letzten Anfrage aus dem Cache kam.
- **Kontext:** wie voll der Chat ist, mit Wetter (☀️ 🌧️ ⛈️) je nach Abstand zum automatischen Compact.
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
claude plugin install cockpit --marketplace Sven-AI2026/cockpit
```

In der Desktop-App: auf + neben dem Eingabefeld klicken, dann Plugins, „Add marketplace“ mit `Sven-AI2026/cockpit`, dann „Add plugin“.

Danach einen neuen Chat starten.
