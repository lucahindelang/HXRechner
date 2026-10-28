# h,x-Rechner Web-App

Statische Web-App zur Berechnung von Zustaenden feuchter Luft mit h,x-Diagramm nach Mollier.

## Funktionen

- Frei waehlbarer Referenzdruck in hPa, Pa, kPa, bar oder ueber die Meereshoehe (Normatmosphaere)
- Eingabe von zwei beliebigen Zustandsgroessen: Temperatur t, relative Feuchte φ, Wassergehalt x, Enthalpie h, Feuchtkugeltemperatur t_f, Taupunkt τ oder Dampfpartialdruck p_D
- Berechnung aller uebrigen Groessen inklusive Saettigungsdruck p_s, Saettigungsgehalt x_s, Dichte ρ und spezifischem Volumen v
- h,x-Diagramm mit Isothermen, Isenthalpen, Linien konstanter relativer Feuchte, Nebelgebiet sowie Taupunkt- und Feuchtkugel-Konstruktion
- Klick ins Diagramm uebernimmt den Punkt (t, x) als Eingabe, beim Ueberfahren werden t, x, φ und h angezeigt
- Speichern mehrerer Zustaende als Prozesskette mit Δh und Δx
- Textausgabe mit Rechenweg zum Kopieren
- Speicherung der Eingaben im Browser (localStorage)

## Hinweise

Der Saettigungsdampfdruck wird nach Sonntag (1990) berechnet, unter 0 °C ueber Eis. Die Enthalpie folgt `h = 1.006 * t + x * (2501 + 1.86 * t)`.
Nicht kombinierbar sind x, p_D und τ untereinander (gleiche Information) sowie h mit t_f (Linien nahezu parallel). Zustaende im Nebelgebiet (φ > 100 %) werden nicht berechnet.

## GitHub Pages

Die App benoetigt keinen Build-Schritt. `index.html`, `style.css` und `app.js` koennen direkt als statische Seite gehostet werden.
