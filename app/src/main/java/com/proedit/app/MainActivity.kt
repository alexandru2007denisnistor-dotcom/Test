package com.proedit.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.proedit.app.ui.EditorScreen
import com.proedit.app.ui.EditorViewModel
import com.proedit.app.ui.HomeScreen
import com.proedit.app.ui.ProEditTheme

class MainActivity : ComponentActivity() {
    private val editorVm: EditorViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shared = sharedVideo(intent)
        setContent {
            ProEditTheme {
                var openId by rememberSaveable { mutableStateOf<String?>(null) }
                var handledShare by rememberSaveable { mutableStateOf(false) }
                androidx.compose.runtime.LaunchedEffect(Unit) {
                    if (shared != null && !handledShare) {
                        handledShare = true
                        editorVm.create(listOf(shared)) { openId = it }
                    }
                }
                val id = openId
                if (id == null) {
                    HomeScreen(
                        onOpen = { openId = it },
                        onCreate = { uris -> editorVm.create(uris) { newId -> openId = newId } },
                        busy = editorVm.busy,
                    )
                } else {
                    BackHandler {
                        editorVm.engine.pause()
                        editorVm.saveNow()
                        openId = null
                    }
                    EditorScreen(vm = editorVm, projectId = id, onBack = {
                        editorVm.engine.pause()
                        editorVm.saveNow()
                        openId = null
                    })
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        editorVm.engine.pause()
    }

    private fun sharedVideo(intent: Intent?): Uri? {
        if (intent?.action != Intent.ACTION_SEND) return null
        return if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
}
