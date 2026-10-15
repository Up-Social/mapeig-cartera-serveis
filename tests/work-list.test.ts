import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkTable, TableActionLink } from "../components/work-list";
import { FilterForm } from "../components/filter-form";
import { WORK_TABLE_PROFILES } from "../lib/work-table-profiles";

test("els perfils reserven el 100% de l’amplada amb columnes identificades", () => {
  for (const profile of Object.values(WORK_TABLE_PROFILES)) {
    assert.equal(profile.columns.reduce((sum, column) => sum + column.width, 0), 100);
    assert.equal(new Set(profile.columns.map(c => c.id)).size, profile.columns.length);
    assert.ok(profile.columns.every(c => c.width > 0 && c.label.length > 0));
  }
  assert.equal(WORK_TABLE_PROFILES.review.columns[0].width, 52);
  assert.equal(WORK_TABLE_PROFILES.issues.columns[1].width, 30);
  assert.equal(WORK_TABLE_PROFILES.sourceComparison.minimum, 48);
});

test("la taula conserva títols complets, enllaços de retorn i seleccions", () => {
  const title = "Resolució amb un títol llarg i noms complets. ".repeat(30);
  const href = "/records/example?from=%2Fapproved%3Fpage%3D2";
  const html = renderToStaticMarkup(h(WorkTable, { profile: "approved", children: h("tr", {},
    h("td", {}, h("input", { type: "checkbox", checked: true, readOnly: true, "aria-label": "Seleccionar exemple" })),
    h("td", {}, h("a", { href }, title)), h("td", {}, "Entitat amb nom complet"),
    h("td", {}, "0,00 €"), h("td", {}, "Aprovat"), h("td", {}, "280"), h("td", {}, "Obrir")) }));
  assert.ok(html.includes(title));
  assert.ok(html.includes(href));
  assert.match(html, /checked=""/);
  assert.match(html, /data-column="service" data-role="primary"/);
  assert.match(html, /data-label="Import" data-column="amount"/);
  assert.ok(html.includes("0,00 €"));
  assert.match(html, /scope="col"/);
});

test("les accions mostren el text específic i conserven el nom accessible", () => {
  const html = renderToStaticMarkup(h(TableActionLink, { href: "/records/example", label: "Revisar la resolució completa", children: "Revisar" }));
  assert.match(html, /aria-label="Revisar la resolució completa"/);
  assert.match(html, /<span>Revisar<\/span>/);
  assert.match(html, /href="\/records\/example"/);
});

test("els filtres només s’envien explícitament i mantenen el context ocult", () => {
  const element = FilterForm({ children: [h("input", { key: "q", name: "q", "aria-label": "Cercar casos", defaultValue: "Girona" }), h("input", { key: "batch", name: "batch", type: "hidden", value: "batch-example" }), h("button", { key: "apply" }, "Aplicar filtres")] });
  assert.equal(element.props.method, "get");
  assert.equal(element.props.onChange, undefined);
  const html = renderToStaticMarkup(element);
  assert.match(html, /<label[^>]*><span>Cercar casos<\/span>/);
  assert.match(html, /name="batch"[^>]*value="batch-example"/);
  assert.match(html, />Aplicar filtres<\/button>/);
  assert.ok(!html.includes('name="page"'));
});
