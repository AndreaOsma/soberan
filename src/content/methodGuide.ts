export type MethodGuideSection = {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
};

export const METHOD_CYCLE_STEPS = [
  {
    n: 1,
    label: "Ingresos",
    hint: "Tu nómina y otros ingresos que se repiten cada mes se apuntan en Laboral. Eso es lo que tienes disponible para repartir.",
  },
  {
    n: 2,
    label: "Presupuesto",
    hint: "Antes de gastar, repartes ese dinero en partidas: gastos fijos, suscripciones, tu dinero libre y ahorro.",
  },
  {
    n: 3,
    label: "Mes en curso",
    hint: "Cada movimiento que registras se compara con ese reparto, y en Inicio ves de un vistazo cómo va tu fondo de emergencia y tu ahorro.",
  },
  {
    n: 4,
    label: "Cierre mensual",
    hint: "Al acabar el mes comparas lo planeado con lo que realmente pasó y anotas qué te gustaría cambiar el mes siguiente.",
  },
] as const;

export const METHOD_503020_ROWS = [
  { block: "Necesidades", pct: "~50%", items: "Gastos fijos: alquiler o hipoteca, suministros, seguros, deudas" },
  { block: "Deseos", pct: "~30%", items: "Tu dinero para gastar como quieras: ocio, caprichos, salidas" },
  { block: "Ahorro", pct: "~20%", items: "Lo que apartas para el futuro: ahorro e inversión" },
] as const;

export const METHOD_SUMMARY_LEAD =
  "Soberan te ayuda a organizar tu dinero mes a mes con el método de los sobres: en vez de un sobre físico, cada «partida» es el sobre donde metes el dinero para algo concreto. Repartes ahí lo que ingresas, apuntas lo que gastas y, al cerrar el mes, comparas lo planeado con lo que realmente ha pasado.";

export const METHOD_SUMMARY_ASSIGN =
  "Intenta repartir todo tu ingreso entre partidas. Lo que dejes sin asignar no desaparece: sigue disponible (normalmente lo verás en Libre). No es que ese dinero esté «suelto» en el banco; simplemente en la app todavía no le has puesto una etiqueta.";

export const METHOD_SECTIONS: MethodGuideSection[] = [
  {
    id: "cycle",
    title: "Flujo del mes",
    body: "La app está pensada para seguir este orden cada mes. No es obligatorio, pero así es como encajan Presupuesto, Inicio y el cierre mensual.",
    bullets: METHOD_CYCLE_STEPS.map((s) => `${s.label}: ${s.hint}`),
  },
  {
    id: "503020",
    title: "Plantilla 50/30/20",
    body: "Es una forma orientativa de repartir tus ingresos entre necesidades, deseos y ahorro. Te sirve como punto de partida el primer mes, pero los porcentajes son solo una sugerencia: si el alquiler o la hipoteca se llevan más del 50%, ajusta sin agobiarte por cuadrar el número exacto.",
    bullets: METHOD_503020_ROWS.map((r) => `${r.block} (${r.pct}): ${r.items}`),
  },
  {
    id: "modules",
    title: "Dónde está cada cosa",
    body: "Además de la pantalla de Presupuesto, esto es lo que encontrarás en la app:",
    bullets: [
      "Inicio: de un vistazo, cómo vas de fondo de emergencia y de ahorro, según el perfil que elijas en Configuración.",
      "Presupuesto: las partidas del mes, las plantillas para repartir, y lo que todavía te queda por asignar.",
      "Calendario: cuándo vencen tus cuotas y pagos recurrentes.",
      "Cierre mensual: un resumen de lo planeado frente a lo real, con una checklist para cerrar el mes.",
    ],
  },
];

export const METHOD_TIPS: string[] = [
  "La partida importa más que la cuenta bancaria: un gasto en Libre no reduce el fondo de comida, aunque el dinero salga de la misma cuenta.",
  "Salirte del plan algún mes no rompe nada. Para eso está el cierre mensual: para ver la diferencia y decidir qué cambiar.",
  "El perfil de estabilidad de tus ingresos (en Configuración) determina cuántos meses de fondo de emergencia te recomienda Inicio, más o menos entre 3 y 12 según lo estable que sea tu trabajo.",
  "Para arrancar suele bastar con esto: dar de alta tu cuenta con el saldo actual, tu nómina en Laboral, y aplicar la plantilla 50/30/20 (o copiar un mes anterior si ya tienes uno).",
];
