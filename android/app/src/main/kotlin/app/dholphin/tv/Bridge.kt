// Docs: docs/02 - Tech/Android App.md
// Purpose: what the page may ask of Android, as `DholphinAndroid`: open the Netflix app, the phone form, updates, leaving.
package app.dholphin.tv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.JavascriptInterface
import org.json.JSONArray
import java.net.Inet4Address
import java.net.NetworkInterface
import org.json.JSONObject

/**
 * Every call checks its input against what Dholphin itself needs, because a page's frames (a YouTube player) may
 * reach the same object: only the Netflix apps open, only Netflix addresses, only this app's own releases install.
 */
class Bridge(private val activity: Activity, private val send: (JSONObject) -> Unit) {
    private val phone = PhoneForm(activity) { values -> send(JSONObject().put("t", "phone").put("values", values)) }
    private val updater = Updater(activity) { event -> send(event.put("t", "update")) }

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
    @JavascriptInterface fun build(): String = BuildConfig.VERSION_CODE.toString()

    /** "yes" when one of these allowed apps is installed. */
    @JavascriptInterface fun installed(packagesJson: String): String =
        if (packages(packagesJson).any(::isInstalled)) "yes" else "no"

    /**
     * Opens a Netflix address in the first installed Netflix app, as Android's "view" intent with its extras.
     * Docs: Android/Sending Users to Another App. The `source` extra is Netflix's, undocumented: see Netflix Provider.
     */
    @JavascriptInterface fun openApp(url: String, packagesJson: String, extrasJson: String): String {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || uri.host != "www.netflix.com") return "refused"
        val pkg = packages(packagesJson).firstOrNull(::isInstalled) ?: return "missing"
        val extras = runCatching { JSONObject(extrasJson) }.getOrDefault(JSONObject())
        val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // String values only: Netflix reads `source` as a string.
        extras.keys().forEach { k -> if (k in ALLOWED_EXTRAS) intent.putExtra(k, extras.optString(k)) }
        return try {
            activity.startActivity(intent)
            "ok"
        } catch (e: ActivityNotFoundException) {
            "missing"
        }
    }

    /** Starts the phone form: answers {url, qr} with the QR code as a PNG data address, or {error}. */
    @JavascriptInterface fun phoneStart(title: String, fieldsJson: String): String = phone.start(title, JSONArray(fieldsJson)).toString()
    @JavascriptInterface fun phoneStop() = phone.stop()

    /** A QR code (PNG data address) of a short text, such as the server panel's address. */
    @JavascriptInterface fun qr(text: String): String = if (text.length in 1..512) phone.qr(text) else ""

    /** This TV's private IPv4 addresses, so the page can look for a Dholphin server on the same networks. */
    @JavascriptInterface fun localAddresses(): String = runCatching {
        JSONArray(NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().filter { it.isSiteLocalAddress }
            .mapNotNull { it.hostAddress }).toString()
    }.getOrDefault("[]")

    /** Downloads and installs a newer version of this app. Progress and the result come back as `update` events. */
    @JavascriptInterface fun installUpdate(url: String) = updater.install(url)

    @JavascriptInterface fun exit() = activity.runOnUiThread { activity.finish() }

    fun close() = phone.stop()

    private fun packages(json: String): List<String> =
        runCatching { JSONArray(json) }.getOrDefault(JSONArray()).let { a -> (0 until a.length()).map { a.optString(it) } }.filter { it in ALLOWED_APPS }

    private fun isInstalled(pkg: String): Boolean = try {
        activity.packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    companion object {
        /** The apps Dholphin may open, declared in the manifest's <queries> too. Docs: Android/Package Visibility. */
        val ALLOWED_APPS = setOf("com.netflix.ninja", "com.netflix.mediaclient")
        val ALLOWED_EXTRAS = setOf("source")
    }
}
