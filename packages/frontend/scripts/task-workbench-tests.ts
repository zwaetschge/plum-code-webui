import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getActiveTodoPresentation,
  getTaskWorkbenchState,
  type TaskWorkbenchStateInput,
} from '../src/components/session/taskWorkbenchState.js';

const activeTodo = getActiveTodoPresentation([
  { content: 'Already done', status: 'completed' },
  { content: 'Queued fallback', status: 'pending' },
  {
    content: 'Implement capability',
    activeForm: 'Implementing capability',
    status: 'in_progress',
  },
]);

assert.equal(activeTodo.todo?.content, 'Implement capability');
assert.equal(activeTodo.text, 'Implementing capability');
assert.deepEqual(getActiveTodoPresentation([{ content: 'Done', status: 'completed' }]), {
  todo: undefined,
  text: undefined,
});

const baseInput: TaskWorkbenchStateInput = {
  sessionStatus: 'stopped',
  isActive: false,
  pendingTasksCount: 0,
  completedTasksCount: 0,
  totalTasksCount: 0,
  canUseCodexGoal: true,
  composerSteersWhileActive: false,
  composerQueuesWhileActive: false,
  queuedDepth: 0,
  hasSelectedTool: false,
};

assert.deepEqual(getTaskWorkbenchState(baseInput), {
  headerTone: 'idle',
  headerStatusLabel: 'Idle',
  headerDetail: 'No active task yet',
  progressLabel: 'No plan yet',
  // The bubble above the chat bar always names what the agent does now (5daefce):
  // an idle agent waits for the user instead of showing nothing.
  composerStatusLabel: 'Wartet auf dich',
  composerStatusDetail: '',
});

const queuedState = getTaskWorkbenchState({
  ...baseInput,
  isActive: true,
  pendingTasksCount: 2,
  completedTasksCount: 1,
  totalTasksCount: 3,
  composerQueuesWhileActive: true,
  queuedDepth: 2,
  activeTodoText: 'Running focused tests',
  activityMessage: 'Typechecking frontend',
});
assert.equal(queuedState.headerTone, 'working');
assert.equal(queuedState.headerStatusLabel, 'Working');
assert.equal(queuedState.headerDetail, 'Typechecking frontend');
assert.equal(queuedState.progressLabel, '1/3 done');
assert.equal(queuedState.composerStatusLabel, 'Arbeitet · 2 in der Warteschlange');
assert.equal(queuedState.composerStatusDetail, 'Running focused tests');

const steeringState = getTaskWorkbenchState({
  ...baseInput,
  isActive: true,
  composerSteersWhileActive: true,
  activeAgentLabel: 'Reviewer',
});
assert.equal(steeringState.headerStatusLabel, 'Steering');
assert.equal(steeringState.headerDetail, 'Reviewer running');
assert.equal(steeringState.composerStatusLabel, 'Arbeitet · lenkbar');
assert.equal(steeringState.composerStatusDetail, 'Reviewer running');

const errorState = getTaskWorkbenchState({
  ...baseInput,
  sessionStatus: 'error',
  isActive: true,
  composerQueuesWhileActive: true,
  lastMessage: 'Provider disconnected',
});
assert.equal(errorState.headerTone, 'error', 'errors must dominate active-run styling');
assert.equal(errorState.headerStatusLabel, 'Needs attention');
assert.equal(errorState.headerDetail, 'Provider disconnected');
assert.equal(errorState.composerStatusLabel, 'Braucht dich', 'errors must dominate the bubble too');
const failedRun = getTaskWorkbenchState({ ...baseInput, sessionStatus: 'error' });
assert.equal(failedRun.composerStatusLabel, 'Braucht dich');
assert.equal(failedRun.composerStatusDetail, 'Der letzte Lauf ist fehlgeschlagen.');

const plainRun = getTaskWorkbenchState({ ...baseInput, isActive: true });
assert.equal(plainRun.composerStatusLabel, 'Arbeitet');
assert.equal(plainRun.composerStatusDetail, '');
const emptyQueue = getTaskWorkbenchState({
  ...baseInput,
  isActive: true,
  composerQueuesWhileActive: true,
});
assert.equal(emptyQueue.composerStatusLabel, 'Arbeitet');
assert.equal(
  emptyQueue.composerStatusDetail,
  'Neue Nachrichten warten, bis der Lauf fertig ist.',
  'a queueing run explains where new messages go'
);
const idleWithTodo = getTaskWorkbenchState({ ...baseInput, activeTodoText: 'Left over' });
assert.equal(idleWithTodo.composerStatusDetail, '', 'an idle bubble carries no stale run detail');

const selectedToolState = getTaskWorkbenchState({
  ...baseInput,
  canUseCodexGoal: false,
  hasSelectedTool: true,
  selectedToolName: 'Android builder',
});
assert.equal(selectedToolState.progressLabel, 'No task list');
assert.equal(selectedToolState.composerStatusLabel, 'Android builder');

// The workbench header with run view, goal and stop/restart buttons was folded
// into the composer on 2026-09-28: TaskWorkbench.tsx now only renders the
// floating todo strip above the chat bar, and the composer bubble owns status,
// interrupt and details.
const componentSource = fs.readFileSync(
  new URL('../src/components/session/TaskWorkbench.tsx', import.meta.url),
  'utf8'
);
const chatInputSource = fs.readFileSync(
  new URL('../src/components/chat/ChatInput.tsx', import.meta.url),
  'utf8'
);
const sessionPageSource = fs.readFileSync(
  new URL('../src/pages/SessionPage.tsx', import.meta.url),
  'utf8'
);
assert.match(
  componentSource,
  /if \(!todo \|\| pendingTasksCount === 0\) return null;/,
  'the todo strip must disappear once nothing is left to do'
);
assert.match(componentSource, /todo\.status === 'in_progress' && todo\.activeForm/);
assert.match(
  componentSource,
  /aria-label=\{`Tasks: \$\{completedTasksCount\}\/\$\{totalTasksCount\} complete, \$\{pendingTasksCount\} remaining\. Open task list`\}/,
  'the strip must announce its progress and that it opens the task list'
);
assert.match(
  sessionPageSource,
  /<TodoFloatingStrip[\s\S]*?onOpenTasks=\{\(\) => openRightPanel\('progress'\)\}/,
  'the strip must open the progress panel'
);
assert.match(
  sessionPageSource,
  /activeStatusLabel=\{taskWorkbenchState\.composerStatusLabel\}[\s\S]*?activeStatusDetail=\{taskWorkbenchState\.composerStatusDetail\}/,
  'the composer bubble must show the workbench state'
);
assert.match(
  chatInputSource,
  /onInterrupt && canInterrupt && \([\s\S]*?onClick=\{onInterrupt\}[\s\S]*?aria-label=\{isExecutingTool \? 'Cancel tool' : 'Interrupt current run'\}/,
  'an interruptible run should expose an explicit interrupt action in the bubble'
);
assert.match(
  chatInputSource,
  /onOpenRun && isActive && \([\s\S]*?className="composer-brief-run"[\s\S]*?Details/,
  'the run-view action should be labelled as details rather than execution'
);

console.log('Task workbench regression tests passed.');
