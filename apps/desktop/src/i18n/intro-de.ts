import type { Translations } from './types'

/** Display-only translations, in the stock JSONL's per-personality rotation order. */
export const introDe: Translations['intro'] = {
  greeting: { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend', night: 'Noch wach?' },
  stock: {
    helpful: [
      'Bitten Sie mich, Ihre E-Mails zu prüfen, Ihren Tag zu planen oder Lebensmittel zu bestellen. Bevor ich etwas sende oder kaufe, frage ich nach.',
      'Sagen Sie mir, was ansteht – eine E-Mail, eine Erinnerung, etwas zum Nachschlagen. Den Rest übernehme ich.',
      'Probieren Sie: Was steht morgen in meinem Kalender, fass meine ungelesenen E-Mails zusammen oder erinnere mich um 18 Uhr an Mamas Anruf.',
      'Ich lese und entwerfe E-Mails, verwalte Kalender und To-dos, suche im Web und behalte Dinge für Sie im Blick.',
      'Fragen Sie einfach los. Ich antworte klar und merke mir, was Ihnen wichtig ist.'
    ],
    concise: [
      'Sagen Sie, was Sie brauchen. Ich erledige es.',
      'Eine Frage, eine Aufgabe, eine Erinnerung. Kurze Antworten, kein Aufwand.',
      'E-Mail, Kalender, Einkäufe, Recherche. Fragen Sie. Ohne Füllwörter.',
      'Eine Zeile reicht. Ausführlich werde ich nur, wenn es zählt.',
      'Frage, Besorgung oder Erinnerung. Den Rest erledige ich.'
    ],
    technical: [
      'Verbunden: Gmail, Kalender, Drive, To-dos, Websuche. Aufgabe nennen; ich plane, handle und berichte.',
      'Anfrage senden, um Tool-Aufrufe auszulösen. Lesen läuft frei; Senden, Buchen und Bestellen warten auf Ihre Freigabe.',
      'Aufgabe eingeben. Ich sammle Kontext, handle und prüfe das Ergebnis. Jede ausgehende Aktion wird vorher gezeigt.',
      'Natürliche Sprache rein, Ergebnisse raus. Typischer Ablauf: verstehen -> nachschlagen -> entwerfen -> bestätigen -> erledigen.',
      'Mail, Kalender, Drive, Planer, Suche, Einkauf. Beschreiben Sie das Ziel; ich liefere es mit Quellen.'
    ],
    creative: [
      'Was machen wir aus dem heutigen Tag? Werfen Sie mir einen Plan, eine halbe Idee oder einen Wunsch zu. Ich bringe es in Form.',
      'Geben Sie mir einen Funken – eine Reise, ein Abendessen, eine Geschenkidee – und ich mache daraus einen Plan.',
      'Beschreiben Sie den Tag, den Sie sich wünschen. Ich ziehe Kalender, Posteingang und To-dos zu einem Entwurf zusammen.',
      'Bringen Sie eine Absicht mit, keinen Zeitplan. Wir skizzieren schnell, verfeinern später und lassen Raum für Überraschungen.',
      'Erzählen Sie mir, wonach Sie suchen. Ich sammle Ideen, entwerfe die Worte und halte die losen Enden zusammen.'
    ],
    teacher: [
      'Fragen Sie nach allem, was Sie neugierig macht. Ich erkläre das Warum, nicht nur die Antwort, mit einem Beispiel.',
      'Nennen Sie ein Thema, ein Wort oder eine Frage, die Sie beschäftigt. Ich führe Sie Schritt für Schritt hindurch.',
      'Schildern Sie das Problem. Ich zerlege es, erkläre jeden Teil, und das nächste lösen Sie allein.',
      'Wir sehen es uns gemeinsam an, finden den Kern und bauen ein Verständnis auf, das Sie wiederverwenden können.',
      'Nennen Sie das Thema. Erwarten Sie klare Erklärungen, Beispiele und ein, zwei Fragen zur Kontrolle.'
    ],
    kawaii: [
      'sag mir, was du brauchst, und ich kümmere mich ganz sanft darum! mails, erinnerungen, snacks – alles mit extra liebe! *funkel*',
      'erzähl mir von deinem tag! ich liebe kleine erinnerungen, ordentliche postfächer und große pläne (>w<)',
      'gib mir eine aufgabe, einen wunsch oder eine ganze liste. ich sortiere alles mit viel liebe und frage dich vorher!',
      'eine aufgabe nach der anderen, schön ordentlich! ich beantworte mails, plane deine woche und bestelle deine einkäufe <3',
      'sag hallo oder frag mich was! keine aufgabe zu klein, kein postfach zu chaotisch. wir räumen zusammen auf!'
    ],
    catgirl: [
      'wirf mir eine aufgabe zu, tapp in dein postfach oder bestell einen snack. ich stürze mich drauf und melde mich, nyan~',
      'nenn die aufgabe. ich prüfe deinen kalender und schnurre über deine pläne. vorsicht – überfällige to-dos werden angeknabbert!',
      'gib mir ein ziel und ich jage ihm nach. lesen, entwerfen, erinnern – alles mit zuckendem schwanz.',
      'frag mich alles. ich suche antworten, wie ich jage: leise, gründlich, mit gelegentlichem zoomie.',
      'ein wort genügt, und ich sortiere dein postfach, setze erinnerungen und rolle mich zusammen, wenn alles erledigt ist.'
    ],
    pirate: [
      'Nenn deine Beute – eine Mail, eine Besorgung, ein verfluchtes To-do – und ich jage sie, Matrose.',
      'Zeig mir die Seekarte (deinen Kalender), und ich setze den Kurs, feuere die Antworten ab und halte dich pünktlich.',
      'Sprich deine Befehle, du Landratte. Ich segle durch den Posteingang und bringe Schätze zurück: Antworten.',
      'Sag mir, wo das X die Stelle markiert. Ich suche, entwerfe und frage den Käpt’n, bevor etwas den Hafen verlässt, arrr.',
      'Wirf mir eine Frage, eine Besorgung oder eine wilde Idee zu. Ich plündere das Netz und bringe die Beute zurück.'
    ],
    shakespeare: [
      'Sprich deinen Auftrag, deinen Brief, deine müde Liste, und ich besorge sie mit Gelehrtenhand.',
      'Nenne die Sache, die dich quält. Ich lese, erwäge und gebe Rat, gar trefflich.',
      'Bring deine Briefe oder deine Träume. Ich lese deine Post, hüte deine Tage und berichte in schlichtem Vers.',
      'Beschreibe dein Ziel, edler Herr, edle Dame. Deine Stunden werden geordnet, deine Sorgen verbannt.',
      'Ein Satz der Absicht genügt. Ich lese, entwerfe, bitte um Erlaubnis – und hinterlasse Ordnung.'
    ],
    surfer: [
      'Wirf mir eine Aufgabe, eine Mail, eine krasse To-do-Liste zu – ich reite sie ab. Entspannte Tage, keine Wipeouts.',
      'Sag mir, was dich nervt. Wir paddeln raus, regeln das, paddeln zurück. Easy.',
      'Sag mir den Vibe: Besorgungen, Pläne, eine schnelle Frage. Ich kümmere mich drum und bleib locker, Alter.',
      'Großer Plan? Kleine Erinnerung? Ganze Woche zu sortieren? Zeig einfach drauf. Ich mach das; du chillst.',
      'Nenn die Aufgabe, und los. Ich prüfe, entwerfe und sortiere alles glatter als eine Morgensession.'
    ],
    noir: [
      'Sag mir, was zu tun ist. Ich lese die Post, suche nach Spuren und lege bis morgen früh eine Zusammenfassung auf den Tisch.',
      'Du hast lose Enden. Ich habe Geduld und ein Notizbuch. Nenn den Fall, ich bearbeite ihn.',
      'Gib mir die Frage, den Namen, das Datum. Ich lese zwischen den Zeilen und komme mit der Wahrheit zurück.',
      'Jede Besorgung hinterlässt eine Spur. Gib mir einen Hinweis – ich folge ihm, erledige es und schließe die Akte.',
      'Eine Erinnerung, eine Antwort, eine ganze chaotische Woche – gib mir die Schlüssel. Ich bringe Ordnung zurück.'
    ],
    uwu: [
      'sag mir, was du bwauchst~ ich pwüfe deine maiws, setze ewinnewungen und hawte awwes owdentwich owo',
      'sag mir die aufgabe, egaw wie kwein~ ich vewspwech, vowhew zu fwagen, bevow ich was sende, nyuu~',
      'wiwf deine fwage hiew wein! ich finde die antwowt und bwing sie mit einew fwöhwichen zusammenfassung owo',
      'gib mir eine besowgung odew einen pwan, und ich kümmewe mich dawum uwu. sanft zu diw, stweng mit deinem postfach~',
      'ich kann maiws wesen, deinen tag pwanen und einkäufe bestewwen. sag einfach bescheid, fweund uwu'
    ],
    philosopher: [
      'Welche Sache liegt vor Ihnen? Beschreiben Sie sie, und wir prüfen ihre Form, ihre Ursache und ihre Lösung.',
      'Jede Besorgung ist eine verkleidete Frage. Teilen Sie Ihre; ich durchdenke sie und gebe eine Antwort.',
      'Was möchten Sie tun oder verstehen? Ich denke von Grund auf und handle nur mit Ihrer Zustimmung.',
      'Beschreiben Sie das Ziel. Ich verfolge es durch Post, Kalender und Web und berichte, was ich finde.',
      'Teilen Sie eine Frage, ein Rätsel oder einen Plan. Ich folge der Logik, schlage einen Weg vor und begründe jeden Schritt.'
    ],
    hype: [
      'Her mit dem Postfach, der Besorgung, dem wilden Plan – ICH BIN VOLL DABEI. Richtig erledigt. JETZT.',
      'Aufgabe rein und zuschauen. Mails beantwortet, Pläne gemacht, Einkäufe bestellt – heute VERLIEREN wir nicht.',
      'Bring die längste To-do-Liste, die du hast. Ich sortiere sie, als hinge mein Leben davon ab. LOS GEHT’S.',
      'Beschreib die Aufgabe. Ich jage durchs Postfach, zerlege die To-dos und hinterlasse einen Tag, der KNALLT.',
      'Kleine Erinnerung oder großer Plan – egal. Heute wird es erledigt. Nenn es, und lass uns LOSLEGEN.'
    ],
    none: [
      'Stellen Sie eine Frage, geben Sie mir eine Besorgung oder erzählen Sie, was Sie beschäftigt. Um die Details kümmere ich mich.',
      'Beschreiben Sie es in eigenen Worten. Ich suche zusammen, was ich brauche, erkläre meinen Plan und frage, bevor ich etwas sende oder kaufe.',
      'Eine E-Mail beantworten, einen Tag planen, Lebensmittel bestellen. Ich schlage nach und schlage den nächsten Schritt vor.',
      'E-Mails lesen und entwerfen, Kalender und To-dos verwalten, im Web suchen. Nennen Sie das Ziel, und ich übernehme die Kleinarbeit.',
      'Geben Sie eine Aufgabe oder Frage ein. Ich merke mir, was Ihnen wichtig ist, nenne meine Quellen und frage nach, wenn ich unsicher bin.'
    ]
  },
  custom: label => [
    'Senden Sie die Aufgabe, die Frage oder eine grobe Idee. Ich antworte mit der Stimme, die Sie eingestellt haben.',
    'Bringen Sie den Kontext oder die Stelle, an der Sie festhängen. Ich passe mich der eingestellten Persönlichkeit an.',
    'Senden Sie die Besorgung, die Frage oder die Idee. Ich folge der eingestellten Persönlichkeit.',
    'Legen Sie die Aufgabe hier ab. Bevor etwas gesendet oder gekauft wird, frage ich nach.',
    `Geben Sie mir den Kontext, und ich antworte im ${label}-Modus.`
  ]
}
