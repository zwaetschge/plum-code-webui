export const CHAT_CAPABILITIES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_api_tool_approvals (
    turn_id TEXT NOT NULL REFERENCES assistant_api_turns(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    function_name TEXT NOT NULL, arguments_hash TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','allow','deny')),
    created_at TEXT NOT NULL, decided_at TEXT, PRIMARY KEY(turn_id,call_id)
  )`,
];
