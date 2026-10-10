import type { Translations } from './types'

/** Display-only translations, in the stock JSONL's per-personality rotation order. */
export const introFr: Translations['intro'] = {
  greeting: { morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir', night: 'Encore debout ?' },
  stock: {
    helpful: [
      'Demandez-moi de vérifier vos e-mails, de planifier votre journée ou de commander vos courses. Je vous demande avant d’envoyer ou d’acheter quoi que ce soit.',
      'Dites-moi ce qui vous attend – un e-mail à traiter, un rappel, une recherche. Je m’occupe du reste.',
      'Essayez : qu’ai-je demain dans mon agenda, résume mes e-mails non lus, ou rappelle-moi d’appeler Maman à 18 h.',
      'Je lis et rédige vos e-mails, gère votre agenda et vos tâches, cherche sur le web et garde un œil sur ce qui compte.',
      'Posez-moi une question pour commencer. Je réponds clairement et je retiens ce qui compte pour vous.'
    ],
    concise: [
      'Dites ce qu’il vous faut. Je m’en charge.',
      'Une question, une tâche, un rappel. Réponses courtes, sans détour.',
      'E-mail, agenda, courses, recherche. Demandez. Sans remplissage.',
      'Une ligne suffit. Je développe seulement quand c’est utile.',
      'Question, course ou rappel. Je gère le reste.'
    ],
    technical: [
      'Connecté : Gmail, Agenda, Drive, tâches, recherche web. Indiquez une tâche ; je planifie, j’agis et je rends compte.',
      'Envoyez une demande pour déclencher les outils. Les lectures sont libres ; envois, réservations et commandes attendent votre accord.',
      'Saisissez une tâche. Je rassemble le contexte, j’agis et je vérifie le résultat. Chaque action sortante vous est montrée avant.',
      'Langage naturel en entrée, résultats en sortie. Déroulé type : comprendre -> chercher -> rédiger -> confirmer -> faire.',
      'mail, agenda, drive, tâches, recherche, courses. Décrivez le résultat voulu ; je le livre avec mes sources.'
    ],
    creative: [
      'Que fait-on de cette journée ? Lancez-moi un plan, une idée à moitié formée ou un souhait. Je lui donne forme.',
      'Donnez-moi une étincelle – un voyage, un dîner, une idée cadeau – et j’en fais un plan à suivre.',
      'Décrivez la journée que vous voulez. Je réunis agenda, boîte de réception et tâches en un brouillon qui tient.',
      'Apportez une intention, pas un planning. On esquisse vite, on affine ensuite, et on garde de la place pour l’imprévu.',
      'Dites-moi ce que vous poursuivez. Je rassemble des idées, rédige les mots et noue les fils qui dépassent.'
    ],
    teacher: [
      'Posez une question sur tout ce qui vous intrigue. J’explique le pourquoi, pas seulement la réponse, avec un exemple.',
      'Nommez un sujet, un mot ou une question qui vous trotte en tête. Je vous guide pas à pas.',
      'Exposez le problème. Je le découpe, j’explique chaque partie, et vous saurez résoudre le suivant seul.',
      'On regarde ensemble, on trouve le cœur du sujet et on construit une compréhension réutilisable.',
      'Nommez le sujet. Attendez-vous à des explications claires, des exemples et une ou deux questions pour vérifier.'
    ],
    kawaii: [
      'dis-moi ce qu’il te faut et je m’en occupe tout doucement ! e-mails, rappels, goûters – avec plein d’amour ! *paillettes*',
      'raconte-moi ta journée ! j’adore les petits rappels, les boîtes mail bien rangées et les grands projets (>w<)',
      'donne-moi une tâche, un vœu ou toute une liste. je range tout avec amour et je te demande avant !',
      'une tâche à la fois, bien faite ! je réponds à tes mails, je planifie ta semaine et je commande tes courses <3',
      'dis bonjour ou demande-moi n’importe quoi ! aucune tâche trop petite, aucune boîte mail trop en bazar. on range ensemble !'
    ],
    catgirl: [
      'lance-moi une tâche, tapote ta boîte mail ou demande un goûter. je bondis dessus et je reviens te dire, nyan~',
      'dis-moi la tâche. je vérifie ton agenda et je ronronne sur tes plans. attention – je mordille les tâches en retard !',
      'donne-moi un but et je le traque. lire, rédiger, rappeler – avec la queue qui frétille.',
      'demande-moi n’importe quoi. je cherche comme je chasse : en silence, à fond, avec un sprint de temps en temps.',
      'un mot et je trie ta boîte mail, je règle tes rappels et je me roule en boule quand tout est fait.'
    ],
    pirate: [
      'Nomme ta proie – un e-mail, une course, une tâche maudite – et je la traque, moussaillon.',
      'Montre-moi la carte (ton agenda) et je trace la route, tire les réponses et te garde à l’heure.',
      'Donne tes ordres, marin d’eau douce. Je navigue dans la boîte mail et rapporte le trésor : des réponses.',
      'Dis-moi où la croix marque l’endroit. Je cherche, je rédige et je consulte le capitaine avant que quoi que ce soit ne quitte le port.',
      'Lance-moi une question, une course ou une idée folle. Je pille le web et rapporte le butin.'
    ],
    shakespeare: [
      'Dis ta mission, ta lettre, ta liste lasse, et je m’en charge d’une main savante.',
      'Nomme ce qui te tourmente. Je lis, je pèse et je rends un conseil des plus justes.',
      'Présente tes lettres ou tes rêves. Je lirai ton courrier, veillerai sur tes jours et rendrai compte en vers simples.',
      'Décris ton but, noble sire ou gente dame. Tes heures seront ordonnées, tes soucis bannis du royaume.',
      'Une ligne d’intention suffit. Je lis, je rédige, je demande ta permission – et laisse tes affaires en ordre.'
    ],
    surfer: [
      'Balance une tâche, un mail, une liste de dingue – je la surfe. Journées tranquilles, zéro chute.',
      'Dis-moi ce qui te saoule. On rame, on règle ça, on revient. Easy.',
      'Donne-moi le mood : courses, plans, petite question. Je gère et je reste cool, mec.',
      'Gros projet ? Petit rappel ? Semaine entière à trier ? Montre juste du doigt. Je gère ; toi, tu chilles.',
      'Dis la tâche et c’est parti. Je vérifie, je rédige et je range tout plus doux qu’une session à l’aube.'
    ],
    noir: [
      'Dites-moi ce qu’il y a à faire. Je lis le courrier, je cherche les indices et je laisse un résumé sur le bureau avant l’aube.',
      'Vous avez des fils qui pendent. J’ai de la patience et un carnet. Nommez l’affaire, je m’en occupe.',
      'Donnez-moi la question, le nom, la date. Je lis entre les lignes et je reviens avec la vérité.',
      'Chaque course laisse une trace. Donnez-moi une piste – je la suis, je boucle et je ferme le dossier.',
      'Un rappel, une réponse, toute une semaine en vrac – donnez-moi les clés. Je ramène de l’ordre.'
    ],
    uwu: [
      'dis-moi ce qu’iw te faut~ je wegawde tes maiws, je wègwe tes wappews et je wange tout owo',
      'dis-moi wa tâche, même toute petite~ je pwomets de demander avant d’envoyer quoi que ce soit, nyuu~',
      'pose ta question ici ! je twouve wa wéponse et je wa wamène avec un petit wésumé tout content owo',
      'donne-moi une couwse ou un pwan et je m’en occupe uwu. doux avec toi, sévèwe avec ta boîte maiw~',
      'je peux wiwe tes maiws, pwanifier ta jouwnée et commander tes couwses. dis juste we mot, ami uwu'
    ],
    philosopher: [
      'Quelle affaire se tient devant vous ? Décrivez-la, et nous examinerons sa forme, sa cause et son remède.',
      'Chaque course est une question déguisée. Partagez la vôtre ; je la raisonne et je reviens avec une réponse.',
      'Que voulez-vous faire, ou comprendre ? Je raisonne depuis les principes et n’agis qu’avec votre accord.',
      'Décrivez la fin que vous visez. Je la poursuis à travers courrier, agenda et web, et je rapporte ce que je trouve.',
      'Partagez une question, une énigme ou un plan. Je suis la logique, propose une voie et justifie chaque étape.'
    ],
    hype: [
      'Envoie la boîte mail, la course, le plan de fou – JE SUIS À FOND. Bien fait. TOUT DE SUITE.',
      'Lâche ta tâche et regarde-moi gérer. Mails répondus, plans faits, courses commandées – on ne PERD pas aujourd’hui.',
      'Apporte la plus grosse liste de tâches que tu as. Je la trie comme si ma vie en dépendait. C’EST PARTI.',
      'Décris la tâche. Je fonce dans la boîte mail, j’écrase les tâches et je laisse une journée qui ENVOIE.',
      'Petit rappel ou grand plan – peu importe. Aujourd’hui, c’est fait. Dis-le et on BOSSE.'
    ],
    none: [
      'Posez une question, confiez-moi une course ou dites-moi ce qui vous occupe. Je m’occupe des détails.',
      'Décrivez-le avec vos mots. Je trouve ce qu’il me faut, je vous explique mon plan et je vous demande avant d’envoyer ou d’acheter quoi que ce soit.',
      'Un e-mail à répondre, une journée à planifier, des courses à commander. Je cherche et je propose la suite.',
      'Lire et rédiger vos e-mails, gérer votre agenda et vos tâches, chercher sur le web. Donnez le but, je fais le reste.',
      'Tapez une tâche ou une question. Je retiens ce qui compte pour vous, je cite mes sources et je demande quand j’ai un doute.'
    ]
  },
  custom: label => [
    'Envoyez la tâche, la question ou une idée brute. Je réponds avec la voix que vous avez choisie.',
    'Donnez-moi le contexte ou l’endroit où vous bloquez. Je m’adapte à la personnalité choisie.',
    'Envoyez la course, la question ou l’idée. Je suivrai la personnalité choisie.',
    'Déposez la tâche ici. Je vous demande avant d’envoyer ou d’acheter quoi que ce soit.',
    `Donnez-moi le contexte. Je réponds en mode ${label}.`
  ]
}
