import { useRef, useState } from 'react';
import { addProject, deleteProject, openProject, toast, updateProject, useApp } from '../app/store';
import { canAddProject } from '../account/perms';
import { Icon } from '../components/Icon';
import { Button, EmptyState, IconButton, Modal } from '../components/ui';
import { exportProject, importProjectFile } from '../projects/actions';
import { filledCount, newProject, validateProject, type Project } from '../projects/project';
import { WEAPON_PROFILES } from '../weapons/profiles';

const totalSlots = WEAPON_PROFILES.reduce((s, p) => s + p.slots.length, 0);
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : new Date(t).toLocaleDateString('de-DE');
};

export function ProjectsView() {
  const projects = useApp((s) => s.projects);
  const current = useApp((s) => s.currentProjectId);
  const session = useApp((s) => s.session);
  const [creating, setCreating] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = (name: string) => {
    if (!canAddProject()) { setCreating(null); return; }
    const p = newProject(name.trim().slice(0, 60), session?.displayName ?? '');
    addProject(p);
    setCreating(null);
    openProject(p.id);
  };

  return (
    <div className="page">
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, font: '600 20px var(--font-display)' }}>Meine Soundpacks</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Ein Soundpack enthält deine Waffen-Slots, Aufsatz-Sounds und Bearbeitungen. Änderungen werden automatisch gespeichert.</p>
        </div>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>.spproject öffnen</Button>
        <Button variant="primary" icon="plus" onClick={() => setCreating('Mein Soundpack')}>Neues Soundpack</Button>
        <input ref={fileRef} type="file" accept=".spproject,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && (await importProjectFile(f))) toast('info', 'Als neues Soundpack geöffnet'); }} />
      </div>

      {projects.length === 0 ? (
        <div className="panel"><EmptyState icon="folder" title="Noch keine Soundpacks" body="Erstelle dein erstes Soundpack. Du wählst Sounds für Pistol, Pistol MK2 und Pistol .50 – auch mit Schalldämpfer – und SP Tool prüft, dass nichts beim Original bleibt." action={<Button variant="primary" icon="plus" onClick={() => setCreating('Mein Soundpack')}>Neues Soundpack</Button>} /></div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => {
            const filled = WEAPON_PROFILES.reduce((s, w) => s + filledCount(p, w), 0);
            const v = validateProject(p, WEAPON_PROFILES);
            const weapons = WEAPON_PROFILES.filter((w) => filledCount(p, w) > 0).map((w) => w.displayName);
            return (
              <section key={p.id} className="panel p-card" style={current === p.id ? { borderColor: 'var(--accent-line)' } : undefined}>
                <div className="row">
                  <h3 style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</h3>
                  <span className="chip num">v{p.version}</span>
                </div>
                <p>{weapons.length ? weapons.join(' · ') : 'Noch keine Waffen'}</p>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className="chip num">{filled} / {totalSlots} Slots</span>
                  {filled === 0 ? <span className="chip">Leer</span> : v.ok ? <span className="chip ok"><Icon name="check" size={12} />Vollständig</span> : <span className="chip warn">{v.problems.length} zu beheben</span>}
                  <span className="faint small">Bearbeitet {ago(p.updatedAt)}</span>
                </div>
                <div className="row">
                  <Button size="sm" variant="primary" onClick={() => openProject(p.id)}>Öffnen</Button>
                  <Button size="sm" icon="export" onClick={() => void exportProject(p)}>Exportieren</Button>
                  <span className="spacer" />
                  <IconButton icon="edit" title="Umbenennen" onClick={() => setRenaming(p)} />
                  <IconButton icon="copy" title="Duplizieren" onClick={() => { if (!canAddProject()) return; const c = newProject(`${p.name} Kopie`, p.author); addProject({ ...p, id: c.id, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt }, false); toast('success', 'Dupliziert', c.name); }} />
                  <IconButton icon="trash" title="Löschen" onClick={() => setConfirmDelete(p.id)} />
                </div>
              </section>
            );
          })}
        </div>
      )}

      {creating !== null && (
        <Modal onClose={() => setCreating(null)}>
          <form onSubmit={(e) => { e.preventDefault(); if (creating.trim()) create(creating); }}>
            <h3>Neues Soundpack</h3>
            <label className="field" htmlFor="new-project-name">Name</label>
            <input id="new-project-name" className="input" autoFocus value={creating} maxLength={60} onChange={(e) => setCreating(e.target.value)} />
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setCreating(null)}>Abbrechen</Button><Button variant="primary" type="submit" disabled={!creating.trim()}>Soundpack erstellen</Button></div>
          </form>
        </Modal>
      )}
      {renaming && (
        <RenameModal p={renaming} onClose={() => setRenaming(null)} />
      )}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <h3>Soundpack löschen?</h3>
          <p className="muted">„{projects.find((p) => p.id === confirmDelete)?.name}“ und sein Verlauf werden von diesem PC entfernt. Die Sounds in deiner Bibliothek bleiben erhalten.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Abbrechen</Button><Button variant="danger" onClick={() => { deleteProject(confirmDelete); setConfirmDelete(null); toast('info', 'Soundpack gelöscht'); }}>Soundpack löschen</Button></div>
        </Modal>
      )}
    </div>
  );
}

function RenameModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const [name, setName] = useState(p.name);
  const [version, setVersion] = useState(p.version);
  return (
    <Modal onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); updateProject(p.id, (x) => ({ ...x, name: name.trim() || x.name, version: version.trim() || x.version, updatedAt: Date.now() })); onClose(); }}>
        <h3>Soundpack-Details</h3>
        <label className="field" htmlFor="rn-name">Name</label>
        <input id="rn-name" className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="field" htmlFor="rn-ver" style={{ marginTop: 10 }}>Version</label>
        <input id="rn-ver" className="input" value={version} maxLength={16} onChange={(e) => setVersion(e.target.value)} />
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit">Speichern</Button></div>
      </form>
    </Modal>
  );
}
