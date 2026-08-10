import { describe, expect, it } from "vitest";
import type { RecurringEntry, WorkHistory } from "../types";
import {
  formatSepeAlertMessage,
  isUnemployed,
  nextSepeRenewalDate,
  sepeRenewalAlertState,
} from "./unemploymentSepe";

const prestacion: Pick<RecurringEntry, "es_ingreso" | "categoria"> = {
  es_ingreso: true,
  categoria: "Prestación",
};

const jobEnded: Pick<WorkHistory, "fecha_fin"> = {
  fecha_fin: "2026-01-15T00:00:00",
};

describe("isUnemployed", () => {
  it("auto: paro si prestación y sin trabajo activo", () => {
    expect(isUnemployed({}, [jobEnded], [prestacion])).toBe(true);
  });

  it("auto: no paro si hay trabajo activo", () => {
    expect(isUnemployed({}, [{ fecha_fin: null }], [prestacion])).toBe(false);
  });

  it("manual paro fuerza situación", () => {
    expect(isUnemployed({ sepe_status: "paro" }, [{ fecha_fin: null }], [])).toBe(true);
  });

  it("manual activo suprime aunque haya prestación", () => {
    expect(isUnemployed({ sepe_status: "activo" }, [jobEnded], [prestacion])).toBe(false);
  });
});

describe("sepeRenewalAlertState", () => {
  const ref = new Date("2026-04-20T12:00:00");

  it("needs_date sin última renovación confirmada", () => {
    expect(
      sepeRenewalAlertState({}, [jobEnded], [prestacion], ref),
    ).toBe("needs_date");
  });

  it("overdue si pasaron más de 90 días desde última renovación", () => {
    expect(
      sepeRenewalAlertState(
        { sepe_ultima_renovacion: "2026-01-01", sepe_intervalo_dias: "90" },
        [jobEnded],
        [prestacion],
        ref,
      ),
    ).toBe("overdue");
  });

  it("upcoming dentro de 7 días", () => {
    expect(
      sepeRenewalAlertState(
        { sepe_ultima_renovacion: "2026-01-24", sepe_intervalo_dias: "90" },
        [jobEnded],
        [prestacion],
        ref,
      ),
    ).toBe("upcoming");
  });

  it("ok si la próxima renovación está lejos", () => {
    expect(
      sepeRenewalAlertState(
        { sepe_ultima_renovacion: "2026-02-01", sepe_intervalo_dias: "90" },
        [jobEnded],
        [prestacion],
        ref,
      ),
    ).toBe("ok");
  });
});

describe("nextSepeRenewalDate", () => {
  it("suma intervalo a última renovación", () => {
    const next = nextSepeRenewalDate(
      { sepe_ultima_renovacion: "2026-01-01", sepe_intervalo_dias: "90" },
      [],
    );
    expect(next?.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});

describe("formatSepeAlertMessage", () => {
  it("mensaje de needs_date menciona confirmar fecha", () => {
    const msg = formatSepeAlertMessage("needs_date", {}, [jobEnded]);
    expect(msg).toMatch(/última renovación SEPE/i);
  });
});
