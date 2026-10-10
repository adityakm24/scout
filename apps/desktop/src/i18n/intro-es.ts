import type { Translations } from './types'

/** Display-only translations, in the stock JSONL's per-personality rotation order. */
export const introEs: Translations['intro'] = {
  greeting: { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches', night: '¿Trasnochando?' },
  stock: {
    helpful: [
      'Pídeme que revise tu correo, planifique tu día o pida la compra. Te pregunto antes de enviar o comprar nada.',
      'Cuéntame qué tienes pendiente: un correo que responder, un recordatorio, algo que buscar. Yo me encargo.',
      'Prueba: qué tengo mañana en el calendario, resume mis correos sin leer o recuérdame llamar a mamá a las 6.',
      'Leo y redacto correos, gestiono tu calendario y tus tareas, busco en la web y vigilo lo importante por ti.',
      'Pregúntame lo que sea para empezar. Respondo claro y recuerdo lo que te importa.'
    ],
    concise: [
      'Di lo que necesitas. Lo hago.',
      'Una pregunta, una tarea, un recordatorio. Respuestas cortas, sin rodeos.',
      'Correo, calendario, compra, búsqueda. Pide. Sin relleno.',
      'Una línea basta. Solo me extiendo cuando importa.',
      'Pregunta, recado o recordatorio. Yo me encargo del resto.'
    ],
    technical: [
      'Conectado: Gmail, Calendar, Drive, tareas, búsqueda web. Indica una tarea; planifico, actúo e informo.',
      'Envía una petición para activar herramientas. Las lecturas van libres; envíos, reservas y pedidos esperan tu aprobación.',
      'Escribe una tarea. Reúno contexto, actúo y verifico el resultado. Cada acción saliente se muestra antes de ejecutarse.',
      'Lenguaje natural de entrada, resultados de salida. Flujo típico: entender -> buscar -> redactar -> confirmar -> hacer.',
      'correo, calendario, drive, tareas, búsqueda, compras. Describe el resultado; lo entrego con fuentes.'
    ],
    creative: [
      '¿Qué hacemos con el día de hoy? Lánzame un plan, una idea a medias o un deseo. Yo le doy forma.',
      'Dame una chispa – un viaje, una cena, una idea de regalo – y la convierto en un plan que puedas seguir.',
      'Describe el día que quieres. Junto tu calendario, tu correo y tus tareas en un borrador que funcione.',
      'Trae una intención, no un horario. Bocetamos rápido, refinamos después y dejamos sitio a las sorpresas.',
      'Cuéntame qué persigues. Reúno ideas, redacto las palabras y ato los cabos sueltos.'
    ],
    teacher: [
      'Pregunta sobre lo que te despierte curiosidad. Explico el porqué, no solo la respuesta, con un ejemplo.',
      'Nombra un tema, una palabra o una pregunta que te ronde. Te guío paso a paso.',
      'Comparte el problema. Lo divido en partes, explico cada una y podrás resolver el siguiente solo.',
      'Lo miramos juntos, encontramos el fondo y construimos un entendimiento que puedas reutilizar.',
      'Nombra el tema. Espera explicaciones claras, ejemplos y alguna pregunta para comprobar.'
    ],
    kawaii: [
      '¡dime qué necesitas y me encargo con mucho cariño! correos, recordatorios, meriendas – ¡todo con amor extra! *brillitos*',
      '¡cuéntame tu día! me encantan los recordatorios pequeñitos, los buzones ordenados y los planes grandes (>w<)',
      'dame una tarea, un deseo o toda una lista. ¡lo ordeno con mucho amor y te pregunto antes!',
      '¡una tarea cada vez, bien hecha! respondo tus correos, planifico tu semana y pido tu compra <3',
      '¡saluda o pregúntame lo que sea! ninguna tarea es pequeña, ningún buzón es un desastre. ¡lo ordenamos juntos!'
    ],
    catgirl: [
      'lánzame una tarea, toca tu buzón con la patita o pide un snack. salto encima y te aviso, nyan~',
      'dime la tarea. reviso tu calendario y ronroneo sobre tus planes. ¡cuidado – muerdo las tareas atrasadas!',
      'dame un objetivo y lo persigo. leer, redactar, recordar – con la colita moviéndose.',
      'pregúntame lo que sea. busco respuestas como cazo: en silencio, a fondo, con algún sprint de vez en cuando.',
      'di la palabra y ordeno tu buzón, pongo tus recordatorios y me hago una bolita cuando todo esté listo.'
    ],
    pirate: [
      'Nombra tu presa – un correo, un recado, una tarea maldita – y la cazo, grumete.',
      'Enséñame la carta náutica (tu calendario) y trazo el rumbo, disparo las respuestas y te mantengo a tiempo.',
      'Da tus órdenes, marinero de agua dulce. Navego por el buzón y traigo el tesoro: respuestas.',
      'Dime dónde la X marca el sitio. Busco, redacto y consulto al capitán antes de que nada salga del puerto, arrr.',
      'Lánzame una pregunta, un recado o una idea loca. Saqueo la web y vuelvo con el botín.'
    ],
    shakespeare: [
      'Di tu encargo, tu carta, tu lista cansada, y la atenderé con mano de erudito.',
      'Nombra el asunto que te aflige. Leo, sopeso y doy consejo de lo más justo.',
      'Presenta tus cartas o tus sueños. Leeré tu correo, cuidaré tus días e informaré en verso llano.',
      'Describe tu meta, noble señor o señora. Tus horas serán ordenadas, tus cuitas desterradas del reino.',
      'Una línea de intención basta. Leo, redacto, pido tu venia – y dejo tus asuntos en orden.'
    ],
    surfer: [
      'Suelta una tarea, un correo, una lista bestial – la surfeo. Días tranquilos, cero revolcones.',
      'Dime qué te tiene bajón. Remamos, lo arreglamos, volvemos. Fácil.',
      'Dime el rollo: recados, planes, una pregunta rápida. Me encargo y me lo tomo con calma, bro.',
      '¿Plan grande? ¿Recordatorio pequeño? ¿Semana entera por ordenar? Solo señala. Yo lo hago; tú relájate.',
      'Di la tarea y nos vamos. Reviso, redacto y ordeno todo más suave que una sesión al amanecer.'
    ],
    noir: [
      'Dime qué hay que hacer. Leo el correo, busco pistas y dejo un resumen en el escritorio antes del amanecer.',
      'Tienes cabos sueltos. Yo tengo paciencia y una libreta. Nombra el caso y lo trabajo.',
      'Dame la pregunta, el nombre, la fecha. Leo entre líneas y vuelvo con la verdad.',
      'Cada recado deja un rastro. Dame una pista: la sigo, lo cierro y archivo el caso.',
      'Un recordatorio, una respuesta, toda una semana revuelta – dame las llaves. Traigo orden.'
    ],
    uwu: [
      'dime qué necesitas~ weviso tu cowweo, pongo wecowdatowios y wo dejo todo owdenado owo',
      'dime wa tawea, aunque sea pequeñita~ pwometo pweguntar antes de enviaw nada, nyuu~',
      '¡suewta tu pwegunta aquí! encuentwo wa wespuesta y wa twaigo con un wesumen feliz owo',
      'dame un wecado o un pwan y me encawgo uwu. dulce contigo, sevewo con tu buzón~',
      'puedo weew cowweos, pwanificaw tu día y pediw tu compwa. solo di wa pawabwa, amigo uwu'
    ],
    philosopher: [
      '¿Qué asunto tienes delante? Descríbelo y examinaremos su forma, su causa y su remedio.',
      'Cada recado es una pregunta disfrazada. Comparte el tuyo; lo razono y vuelvo con una respuesta.',
      '¿Qué deseas hacer o entender? Razono desde los principios y actúo solo con tu consentimiento.',
      'Describe el fin que buscas. Lo persigo por el correo, el calendario y la web, e informo de lo que encuentro.',
      'Comparte una pregunta, un acertijo o un plan. Sigo la lógica, propongo un camino y justifico cada paso.'
    ],
    hype: [
      'Suelta el buzón, el recado, el plan loco – ESTOY A TOPE. Bien hecho. YA MISMO.',
      'Suelta tu tarea y mírame cocinar. Correos respondidos, planes hechos, compra pedida – hoy NO perdemos.',
      'Trae la lista de tareas más grande que tengas. La ordeno como si me fuera la vida. ¡VAMOS!',
      'Describe la tarea. Arraso el buzón, aplasto las tareas y te dejo un día que LA ROMPE.',
      'Recordatorio pequeño o plan enorme – da igual. Hoy se hace. Dilo y a TRABAJAR.'
    ],
    none: [
      'Haz una pregunta, encárgame un recado o cuéntame qué tienes en mente. Yo me ocupo de los detalles.',
      'Descríbelo con tus palabras. Busco lo que necesito, te explico mi plan y te pregunto antes de enviar o comprar nada.',
      'Un correo que responder, un día que planificar, una compra que pedir. Busco y te propongo el siguiente paso.',
      'Leer y redactar correos, gestionar tu calendario y tus tareas, buscar en la web. Dime el objetivo y me encargo del trabajo pesado.',
      'Escribe una tarea o una pregunta. Recuerdo lo que te importa, cito mis fuentes y pregunto cuando tengo dudas.'
    ]
  },
  custom: label => [
    'Envía la tarea, la pregunta o una idea en bruto. Respondo con la voz que elegiste.',
    'Trae el contexto o la parte en la que te atascaste. Me adapto a la personalidad que elegiste.',
    'Envía el recado, la pregunta o la idea. Sigo la personalidad que elegiste.',
    'Deja la tarea aquí. Te pregunto antes de enviar o comprar nada.',
    `Dame el contexto y responderé en modo ${label}.`
  ]
}
