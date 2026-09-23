import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateReviewArmy } from '../scripts/resolvers/review-army';
import { HOST_PATHS } from '../scripts/resolvers/types';

for (const [skill, dispatch, merge] of [['review', '4.5', '4.6'], ['ship', '9.1', '9.2']]) {
  test(`${skill} retains specialist selection, merge and user gates on Codex`, () => {
    const section = generateReviewArmy({ skillName: skill, host: 'codex', paths: HOST_PATHS.codex, tmplPath: '' });
    const rendered = readFileSync(resolve(import.meta.dir, `../.agents/skills/gstack-${skill}/SKILL.md`), 'utf8');
    for (const text of [section, rendered]) {
      expect(text).toContain(`## Step ${dispatch}: Review Army`);
      expect(text).toContain(`### Step ${merge}: Collect and merge findings`);
      expect(text).toContain('DIFF_LINES < 50');
      expect(text).toContain('[NEVER_GATE]');
      expect(text).toContain('quality_score = max(0, 10 -');
      expect(text).toContain('NEVER auto-applied');
      expect(text).toContain('Codex subagent');
      expect(text).toContain('wait');
    }
    expect(section).not.toContain('run_in_background');
    expect(section).not.toContain('subagent_type');
  });
}

test('workflow reads carry the host contract and full render, except the manual downstream upgrade route', () => {
  const root = resolve(import.meta.dir, '..');
  const contract = readFileSync(join(root, 'plugin/bstack/HOST.md'), 'utf8');
  for (const skill of readdirSync(join(root, 'plugin/bstack/skills'))) {
    const folder = skill === 'bstack' ? 'gstack' : skill === 'upgrade' ? 'gstack-upgrade' : `gstack-${skill}`;
    const result = spawnSync(process.execPath, [join(root, 'scripts/bstack-runtime.ts'), 'read', skill], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    expect(result.status).toBe(0);
    const source = skill === 'upgrade'
      ? join(root, 'plugin/bstack/skills/upgrade/SKILL.md')
      : join(root, '.agents/skills', folder, 'SKILL.md');
    expect(result.stdout).toBe(contract + '\n\n---\n\n' + readFileSync(source, 'utf8'));
  }
});
