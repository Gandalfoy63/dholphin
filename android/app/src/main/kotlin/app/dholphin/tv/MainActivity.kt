// Docs: docs/02 - Tech/Android App.md
// Purpose: the app's one screen: the bundled web app in a WebView (full screen on a TV, around the system bars on a phone), the remote's keys, Back, and the bridge.
package app.dholphin.tv

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    /** A TV (Android TV's leanback): always the whole screen. Otherwise a phone or a tablet, held either way. */
    private val tv by lazy { packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) }
    /** A video plays on a phone or a tablet: sideways, without the system bars. */
    private var watching = false

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
        bridge = Bridge(this, ::send, ::setWatching)
        web.addJavascriptInterface(bridge, "DholphinAndroid")
        if (tv) {
            setContentView(web)
            fullScreen()
        } else {
            // A phone or a tablet: edge to edge, the page kept clear of the status bar, the navigation bar and a
            // notch by padding, which goes to nothing when the bars hide for a video. Docs: Android/Edge to Edge.
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
            WindowCompat.enableEdgeToEdge(window)
            val frame = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0E0E10")); addView(web) }
            // The keyboard too: edge to edge, nothing resizes the page for it, so the padding at the bottom grows to its
            // height and the page (a field, a sheet) stays above it. Docs: Android/Software Keyboard.
            ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
                WindowInsetsCompat.CONSUMED
            }
            setContentView(frame)
            // Light icons on the dark page.
            WindowInsetsControllerCompat(window, frame).isAppearanceLightStatusBars = false
            WindowInsetsControllerCompat(window, frame).isAppearanceLightNavigationBars = false
        }
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

    /**
     * The page plays a video (true) or stopped (false). On a phone or a tablet the screen turns sideways (either way,
     * by the sensor) and the system bars hide, a swipe showing them for a moment; after, both come back. A TV is
     * always sideways and full screen. Android 16 lets a large screen ignore the orientation. Docs:
     * Android/Activity Element, Android/Immersive Mode, Android/Large Screens Orientation.
     */
    fun setWatching(on: Boolean) = runOnUiThread {
        if (tv || on == watching) return@runOnUiThread
        watching = on
        requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        bars()
    }

    private fun bars() {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (watching) c.hide(WindowInsetsCompat.Type.systemBars()) else c.show(WindowInsetsCompat.Type.systemBars())
    }

    private fun fullScreen() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    override fun onResume() {
        super.onResume()
        if (tv) fullScreen() else bars()
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
