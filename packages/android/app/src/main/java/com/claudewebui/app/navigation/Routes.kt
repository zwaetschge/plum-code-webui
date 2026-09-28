package com.claudewebui.app.navigation

/**
 * Sealed hierarchy of all navigation destinations in the app.
 * Top-level routes are objects; parameterized routes are data classes.
 */
sealed class Routes(val route: String) {

    // ---- Auth ----

    /** Login / server connection screen */
    object Login : Routes("login")

    /** Server setup / connection configuration screen */
    object ServerSetup : Routes("server_setup")

    // ---- Main ----

    /** Session list / dashboard */
    object Dashboard : Routes("dashboard")

    /** Realtime sessions, tools and permission activity */
    object Activity : Routes("activity")

    /** Up to four sessions side by side, live. */
    object Monitor : Routes("monitor")

    /** Shared agents, skills, plugins, MCP servers and commands */
    object Library : Routes("library")

    /** Chat view for a specific session */
    data class Chat(val sessionId: String) : Routes(ROUTE) {
        companion object {
            const val ROUTE = "chat/{sessionId}?messageId={messageId}&chatId={chatId}"
            const val ARG_SESSION_ID = "sessionId"
            const val ARG_MESSAGE_ID = "messageId"
            const val ARG_CHAT_ID = "chatId"
            fun createRoute(
                sessionId: String,
                messageId: String? = null,
                chatId: String? = null,
            ): String = buildString {
                append("chat/")
                append(java.net.URLEncoder.encode(sessionId, "UTF-8"))
                val parameters = buildList {
                    messageId?.let {
                        add("messageId=" + java.net.URLEncoder.encode(it, "UTF-8"))
                    }
                    chatId?.let {
                        add("chatId=" + java.net.URLEncoder.encode(it, "UTF-8"))
                    }
                }
                if (parameters.isNotEmpty()) append("?").append(parameters.joinToString("&"))
            }
        }
    }

    /** Create a new session */
    object NewSession : Routes("new_session")

    /** Scratch notes for a session */
    data class Notes(val sessionId: String) : Routes(ROUTE) {
        companion object {
            const val ROUTE = "notes/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "notes/$sessionId"
        }
    }

    // ---- Settings (nested graph) ----

    /** Settings root screen */
    object Settings : Routes("settings")

    /** Detail view for one CLI harness (status + model selection) */
    data class SettingsCliProvider(val providerId: String) : Routes(ROUTE) {
        companion object {
            const val ROUTE = "settings/cli-provider/{providerId}"
            const val ARG_PROVIDER_ID = "providerId"
            fun createRoute(providerId: String) = "settings/cli-provider/$providerId"
        }
    }

    /** MCP server management */
    object SettingsMcp : Routes("settings/mcp")

    /** CLI tool configuration */
    object SettingsCliTools : Routes("settings/cli_tools")

    /** Custom agent configuration */
    object SettingsAgents : Routes("settings/agents")

    /** Tool permissions */
    object SettingsPermissions : Routes("settings/permissions")

    /** Preview, GitHub and Oracle browser for one session. */
    data class DevTools(val sessionId: String, val workingDirectory: String) : Routes(ROUTE) {
        companion object {
            const val ROUTE = "devtools/{sessionId}/{workingDirectory}"
            const val ARG_SESSION_ID = "sessionId"
            const val ARG_WORKING_DIRECTORY = "workingDirectory"
            fun createRoute(sessionId: String, workingDirectory: String) =
                "devtools/$sessionId/" + java.net.URLEncoder.encode(workingDirectory, "UTF-8")
        }
    }

    /** ComfyUI / Discord / Home Assistant status and connection probes */
    object SettingsIntegrations : Routes("settings/integrations")

    /** Containers, watchdogs, users and the audit log */
    object Operations : Routes("operations")

    /**
     * Memory files for a session's working directory.
     *
     * The directory travels in the route because the backend derives the memory
     * folder from the working directory, not from the session id.
     */
    data class Memory(val workingDirectory: String) : Routes(ROUTE) {
        companion object {
            const val ROUTE = "memory/{workingDirectory}"
            const val ARG_WORKING_DIRECTORY = "workingDirectory"
            fun createRoute(workingDirectory: String) =
                "memory/" + java.net.URLEncoder.encode(workingDirectory, "UTF-8")
        }
    }

    // ---- Session-scoped tools ----

    /** File browser for a session's working directory */
    data class FileManager(val sessionId: String) : Routes("file_manager/{sessionId}/{path}") {
        companion object {
            const val ROUTE = "file_manager/{sessionId}/{path}"
            const val ARG_SESSION_ID = "sessionId"
            const val ARG_PATH = "path"

            /**
             * The starting directory travels with the route. It used to be
             * hardcoded to "" at the destination, so the browser opened on an
             * empty path and the directory listing answered 404.
             */
            fun createRoute(sessionId: String, path: String) =
                "file_manager/$sessionId/" + java.net.URLEncoder.encode(path, "UTF-8")
        }
    }

    /** View and edit a workspace file. */
    data class FileViewer(val sessionId: String, val filePath: String) :
        Routes("file_viewer/{sessionId}/{filePath}") {
        companion object {
            const val ROUTE = "file_viewer/{sessionId}/{filePath}"
            const val ARG_SESSION_ID = "sessionId"
            const val ARG_FILE_PATH = "filePath"

            /**
             * Absolute paths contain slashes, which would otherwise be read as
             * route separators, so the path travels URL-encoded.
             */
            fun createRoute(sessionId: String, filePath: String) =
                "file_viewer/$sessionId/" + java.net.URLEncoder.encode(filePath, "UTF-8")
        }
    }

    /** Usage analytics dashboard */
    object Analytics : Routes("analytics")

    /** Checkpoint manager for a session */
    data class CheckpointManager(val sessionId: String) : Routes("checkpoints/{sessionId}") {
        companion object {
            const val ROUTE = "checkpoints/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "checkpoints/$sessionId"
        }
    }

    /** Git manager for a session's repository */
    data class GitManager(val sessionId: String) : Routes("git/{sessionId}") {
        companion object {
            const val ROUTE = "git/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "git/$sessionId"
        }
    }

    /** Usage stats for a session */
    data class Usage(val sessionId: String) : Routes("usage/{sessionId}") {
        companion object {
            const val ROUTE = "usage/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "usage/$sessionId"
        }
    }
}

/** Nested navigation graph tag for settings */
const val SETTINGS_GRAPH = "settings_graph"
