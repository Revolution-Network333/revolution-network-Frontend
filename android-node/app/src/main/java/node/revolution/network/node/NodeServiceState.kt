package node.revolution.network.node

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

data class NodeUiState(
    val running: Boolean = false,
    val sessionId: String? = null,
    val sessionPoints: Int = 0,
    val hashrate: Double = 0.0,
    val lastServerMessage: String? = null,
    val logs: List<String> = emptyList(),
)

object NodeServiceState {
    private val _state = MutableStateFlow(NodeUiState())
    val state = _state.asStateFlow()

    private val _events = MutableSharedFlow<String>(
        replay = 0,
        extraBufferCapacity = 8,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events = _events.asSharedFlow()

    fun setState(reducer: (NodeUiState) -> NodeUiState) {
        _state.value = reducer(_state.value)
    }

    fun log(line: String) {
        val trimmed = line.trim()
        if (trimmed.isEmpty()) return
        setState { s ->
            val next = (s.logs + trimmed).takeLast(120)
            s.copy(logs = next)
        }
    }

    suspend fun event(msg: String) {
        _events.emit(msg)
    }
}
