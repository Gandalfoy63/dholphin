// Docs: docs/02 - Tech/Android App.md
// Purpose: the app's one screen: the bundled web app in a full-screen WebView, the remote's keys, Back, and the bridge.
package app.dholphin.tv

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: Bridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The bundled page is served from an https address, so it is a secure origin with its own storage, and
        // YouTube's player sees a normal Referer. Docs: Android/Load Local Content.
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0E0E10"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                // Trailers start by themselves once shown, as on CoolDash OS.
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
                // Jellyfin and Seerr on the home network are often plain http://.
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                userAgentString = "$userAgentString DholphinTV/${BuildConfig.VERSION_NAME}"
                // The page scales itself to the screen: no text size from the system, no zoom of its own. Docs: Android/WebSettings.
                textZoom = 100
                setSupportZoom(false)
                builtInZoomControls = false
            }
            if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.host == HOST && request.url.encodedPath?.startsWith(HTTP_IMAGE) == true) httpImage(request.url)
                    else assets.shouldInterceptRequest(request.url)

                // The page never navigates away from itself: a link out (such as "Watch on YouTube") goes nowhere.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.isForMainFrame && !request.url.toString().startsWith(ORIGIN)
            }
        }
        bridge = Bridge(this, ::send)
        web.addJavascriptInterface(bridge, "DholphinAndroid")
        setContentView(web)
        fullScreen()
        web.loadUrl(START)
        // Back belongs to the page: it closes what is open, and asks before leaving. The page calls exit() to leave.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'GoBack',bubbles:true}))", null)
            }
        })
    }

    /** Sends an event to the page, as a `dholphin` window event. */
    fun send(event: JSONObject) = runOnUiThread {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('dholphin',{detail:$event}))", null)
    }

    private fun fullScreen() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    override fun onResume() {
        super.onResume()
        fullScreen()
        web.onResume()
    }

    override fun onPause() {
        // Back from Netflix comes here: the page waits, paused, while another app plays.
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        bridge.close()
        web.destroy()
        super.onDestroy()
    }

    /**
     * A picture on a plain http:// server (a Dholphin server or Jellyfin at home), fetched here and handed to the page
     * as its own https address: the WebView then has no mixed content to block or upgrade. Pictures only.
     * Called off the UI thread. Docs: Android/WebViewClient, Android/WebResourceResponse, Android/HttpURLConnection.
     */
    private fun httpImage(url: Uri): WebResourceResponse {
        val none = WebResourceResponse("text/plain", null, 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        val rest = url.encodedPath!!.removePrefix(HTTP_IMAGE)
        val cut = rest.indexOf('/')
        if (cut <= 0) return none
        val target = Uri.decode(rest.substring(0, cut)) + rest.substring(cut) + (url.encodedQuery?.let { "?$it" } ?: "")
        if (!target.startsWith("http://")) return none
        return runCatching {
            val c = (URL(target).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 15000; instanceFollowRedirects = true }
            val type = c.contentType?.substringBefore(';')?.trim() ?: ""
            if (c.responseCode !in 200..299 || !type.startsWith("image/")) {
                c.disconnect()
                none
            } else WebResourceResponse(type, null, 200, "OK", mapOf("Cache-Control" to "public, max-age=31536000, immutable"), c.inputStream)
        }.getOrDefault(none)
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        /** `<origin>/http-image/<encoded http base>/<rest>`: see `viaApp` in the page. */
        const val HTTP_IMAGE = "/http-image/"
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val START = "$ORIGIN/assets/web/index.html"
    }
}
