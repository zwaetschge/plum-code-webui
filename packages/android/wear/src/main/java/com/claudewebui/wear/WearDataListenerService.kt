package com.claudewebui.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * Caches every phone snapshot push, takes over the pairing the phone hands
 * out at /plum/watch-pairing (token stored in [PairingStore], never logged)
 * and pokes tile and complications so glanceable surfaces stay current
 * without polling.
 */
class WearDataListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        var updated = false
        var pairingChanged = false
        events.forEach { event ->
            val item = event.dataItem
            when (item.uri.path) {
                WearSnapshotStore.PATH_SNAPSHOT -> {
                    if (event.type != DataEvent.TYPE_CHANGED) return@forEach
                    DataMapItem.fromDataItem(item).dataMap.getString(WearSnapshotStore.KEY_JSON)
                        ?.let { WearSnapshotStore.cache(this, it) }
                    updated = true
                }
                PairingStore.PATH_PAIRING -> {
                    when (event.type) {
                        DataEvent.TYPE_CHANGED ->
                            PairingStore.apply(this, DataMapItem.fromDataItem(item).dataMap)
                        DataEvent.TYPE_DELETED -> PairingStore.clear(this)
                    }
                    pairingChanged = true
                }
            }
        }
        if (pairingChanged) {
            if (PairingStore.isPaired(this)) {
                RefreshWorker.schedule(this)
                RefreshWorker.refreshNow(this)
            } else {
                RefreshWorker.cancel(this)
                BridgeCache.clear(this)
                PlumBridge.get(this).forget()
            }
            updated = true
        }
        if (updated) GlanceUpdates.request(this)
    }
}
