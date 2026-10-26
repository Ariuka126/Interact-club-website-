const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const COLS = 'id, event_id, parent_id, title, notes, status, claimed_by, claimed_at, sort_order, created_at, updated_at';
const MAX_DEPTH = 3, MAX_TASKS = 200, MAX_ACTIVE_PER_EVENT = 10;
const STATUSES = ['claimed', 'in_progress', 'done'];
const head = { count: 'exact', head: true };

const needMember = (req, res, next) => (req.user.role === 'volunteer' ? bad(res, 'Checklists are for members.', 403) : next());
async function loadEvent(sb, id) { const { data, error } = await sb.from('events').select('id, title, sector').eq('id', id).maybeSingle(); if (error) throw error; return data; }
async function loadTask(sb, id) { const { data, error } = await sb.from('logistics_tasks').select(COLS).eq('id', id).maybeSingle(); if (error) throw error; return data; }
async function withName(sb, task) {
  if (!task || !task.claimed_by) return task && { ...task, claimer: null };
  const { data } = await sb.from('users').select('name').eq('id', task.claimed_by).maybeSingle();
  return { ...task, claimer: data ? data.name : 'Former member' };
}
// Managers: the head of the event's sector, and Presidents.
const managerOf = async (sb, u, task) => { const ev = await loadEvent(sb, task.event_id); return !!ev && K.canRunSector(u, ev.sector); };

router.get('/events/:id/tasks', requireAuth, needMember, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id); if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase, ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    const tasks = await K.fetchAll(() => sb.from('logistics_tasks').select(COLS).eq('event_id', id).order('sort_order'));
    const ids = [...new Set(tasks.map(t => t.claimed_by).filter(Boolean))];
    const people = ids.length ? await K.inBatches(ids, b => sb.from('users').select('id, name').in('id', b)) : [];
    const name = new Map(people.map(p => [p.id, p.name]));
    res.set('Cache-Control', 'no-store');
    res.json({ event: ev, me: req.user.id, canManage: K.canRunSector(req.user, ev.sector),
      tasks: tasks.map(t => ({ ...t, claimer: t.claimed_by ? name.get(t.claimed_by) || 'Former member' : null })) });
  } catch (err) { next(err); }
});

// Organising heads build the task tree: a task can sit under another, up to three levels deep.
router.post('/events/:id/tasks', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user, b = req.body || {}; if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase, ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!K.canRunSector(u, ev.sector)) return bad(res, "Only this event's Sector Head or a President can plan its checklist.", 403);
    const title = K.str(b.title, 2, 120); if (!title) return bad(res, 'Describe the task (2 to 120 characters).');
    const notes = b.notes ? K.str(b.notes, 1, 300) : null; if (b.notes && !notes) return bad(res, 'Keep the notes under 300 characters.');
    const all = await K.fetchAll(() => sb.from('logistics_tasks').select('id, parent_id, sort_order').eq('event_id', id));
    if (all.length >= MAX_TASKS) return bad(res, `A checklist holds up to ${MAX_TASKS} tasks.`, 409);
    let parentId = null;
    if (b.parentId != null && b.parentId !== '') {
      parentId = K.toId(b.parentId);
      const parent = all.find(t => t.id === parentId);
      if (!parent) return bad(res, 'That parent task is not on this event.');
      let depth = 1, cur = parent; while (cur.parent_id) { cur = all.find(t => t.id === cur.parent_id) || { parent_id: null }; depth++; }
      if (depth >= MAX_DEPTH) return bad(res, `Tasks can only go ${MAX_DEPTH} levels deep.`);
      const claimed = await sb.from('logistics_tasks').select('claimed_by').eq('id', parentId).maybeSingle();
      if (claimed.data && claimed.data.claimed_by) return bad(res, 'That task is already claimed, so it cannot be split into smaller ones.', 409);
    }
    const sort = all.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1;
    const { data, error } = await sb.from('logistics_tasks').insert({ event_id: id, parent_id: parentId, title, notes, sort_order: sort, created_by: u.id }).select(COLS).maybeSingle();
    if (error) throw error;
    res.status(201).json({ task: await withName(sb, data) });
  } catch (err) { next(err); }
});

// Claim a micro-task. Only the smallest tasks (the ones with nothing under them) can be claimed, and only one person wins.
router.post('/tasks/:id/claim', requireAuth, needMember, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid task.');
    const sb = req.app.locals.supabase, task = await loadTask(sb, id);
    if (!task) return bad(res, 'Task not found.', 404);
    const kids = await sb.from('logistics_tasks').select('id', head).eq('parent_id', id); if (kids.error) throw kids.error;
    if (kids.count) return bad(res, 'This task is split into smaller ones. Claim one of those.', 409);
    const mine = await sb.from('logistics_tasks').select('id', head).eq('event_id', task.event_id).eq('claimed_by', u.id).in('status', ['claimed', 'in_progress']); if (mine.error) throw mine.error;
    if (mine.count >= MAX_ACTIVE_PER_EVENT) return bad(res, `You already hold ${MAX_ACTIVE_PER_EVENT} open tasks on this event. Finish one first.`, 409);
    const now = new Date().toISOString();
    const { data, error } = await sb.from('logistics_tasks').update({ status: 'claimed', claimed_by: u.id, claimed_at: now, updated_at: now })
      .eq('id', id).eq('status', 'open').is('claimed_by', null).select(COLS).maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'Someone just took this task.', 409);
    res.json({ task: await withName(sb, data) });
  } catch (err) { next(err); }
});

router.post('/tasks/:id/release', requireAuth, needMember, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid task.');
    const sb = req.app.locals.supabase, task = await loadTask(sb, id);
    if (!task) return bad(res, 'Task not found.', 404);
    const manager = await managerOf(sb, u, task);
    if (task.status === 'open') return bad(res, 'That task is not claimed.', 409);
    if (task.claimed_by !== u.id && !manager) return bad(res, 'Only the person who took it, or a head, can release a task.', 403);
    if (task.status === 'done' && !manager) return bad(res, 'A finished task can only be reopened by a head.', 403);
    const { data, error } = await sb.from('logistics_tasks').update({ status: 'open', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).maybeSingle();
    if (error) throw error;
    res.json({ task: await withName(sb, data) });
  } catch (err) { next(err); }
});

router.post('/tasks/:id/status', requireAuth, needMember, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user, status = (req.body || {}).status; if (!id) return bad(res, 'Invalid task.');
    if (!STATUSES.includes(status)) return bad(res, 'Status must be claimed, in progress or done.');
    const sb = req.app.locals.supabase, task = await loadTask(sb, id);
    if (!task) return bad(res, 'Task not found.', 404);
    if (task.status === 'open') return bad(res, 'Claim the task first.', 409);
    if (task.claimed_by !== u.id && !(await managerOf(sb, u, task))) return bad(res, 'Only the person who took the task, or a head, can update it.', 403);
    const { data, error } = await sb.from('logistics_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).maybeSingle();
    if (error) throw error;
    res.json({ task: await withName(sb, data) });
  } catch (err) { next(err); }
});

router.delete('/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id); if (!id) return bad(res, 'Invalid task.');
    const sb = req.app.locals.supabase, task = await loadTask(sb, id);
    if (!task) return bad(res, 'Task not found.', 404);
    if (!(await managerOf(sb, req.user, task))) return bad(res, "Only this event's Sector Head or a President can remove tasks.", 403);
    const { error } = await sb.from('logistics_tasks').delete().eq('id', id); if (error) throw error; // sub-tasks go with it
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
