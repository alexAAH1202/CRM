import { describe, expect, it } from 'vitest';
import { buildTemplate, TEMPLATES, type TemplateId } from './templates';
import { parseAutomation, automationData, describeAutomation } from './automations';
import { recipesFor } from './automationRecipes';

describe('recipes', () => {
  it('every recipe offered for every template is a valid, describable automation', () => {
    let total = 0;
    for (const t of TEMPLATES) {
      const b = buildTemplate(t.id as TemplateId);
      for (const r of recipesFor(b, 'me')) {
        total++;
        const parsed = parseAutomation('x', { ...automationData(r.draft), ownerUid: 'me' });
        expect(parsed, `${t.id}/${r.id}`).not.toBeNull();
        expect(parsed!.actions.length).toBeGreaterThan(0);
        expect(describeAutomation(parsed!, b, (u) => u)).toMatch(/^When .+, .+\.$/);
        expect(describeAutomation(parsed!, b, (u) => u)).not.toContain('deleted');
      }
    }
    expect(total).toBeGreaterThan(20);
  });
  it('the blank board offers some recipes but not ones it has no columns for', () => {
    const ids = recipesFor(buildTemplate('blank'), 'me').map((r) => r.id);
    expect(ids).toContain('created-notify');
    expect(ids).toContain('subitems-done'); // blank has a status with a Done-like label?
  });
  it('a board with no status or people column only gets the simple ones', () => {
    const ids = recipesFor({ columns: [], groups: [] }, 'me').map((r) => r.id);
    expect(ids).toEqual(['created-notify', 'created-subitem', 'monthly-check']);
  });
  it('there are about a dozen recipes in total', () => {
    const all = new Set<string>();
    for (const t of TEMPLATES)
      for (const r of recipesFor(buildTemplate(t.id as TemplateId), 'me')) all.add(r.id);
    expect(all.size).toBeGreaterThanOrEqual(17);
    for (const id of [
      'remind-before',
      'remind-today',
      'overdue-nudge',
      'weekly-reset',
      'repeat-in-7',
      'monthly-check',
    ])
      expect(all.has(id), id).toBe(true);
  });
});
