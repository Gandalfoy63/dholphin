// Docs: docs/03 - Features/Updates.md
// Purpose: downloads a newer Dholphin from its GitHub releases and hands it to Android's installer, which asks to confirm.
package app.dholphin.tv

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class Updater(private val activity: Activity, private val send: (JSONObject) -> Unit) {
    @Volatile private var busy = false

    fun install(url: String) {
        // Only this app's own releases: anything else is refused before a byte is fetched.
        if (!url.startsWith(RELEASES) || busy) return result("failed")
        // Android 8 and later: the person allows Dholphin to install apps once. Docs: Android/Unknown App Sources.
        if (!activity.packageManager.canRequestPackageInstalls()) {
            runCatching { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }
            return result("needs_permission")
        }
        busy = true
        Thread({
            try {
                val apk = download(url)
                commit(apk)
            } catch (e: Exception) {
                android.util.Log.w("Dholphin", "update failed", e)
                result("failed")
            } finally {
                busy = false
            }
        }, "dholphin-update").start()
    }

    private fun download(url: String): File {
        val file = File(activity.cacheDir, "update.apk")
        var c = URL(url).openConnection() as HttpURLConnection
        // GitHub answers with a redirect to its file storage, also https.
        var hops = 0
        while (c.responseCode in 301..308 && hops++ < 5) {
            val next = c.getHeaderField("Location") ?: break
            c.disconnect()
            c = URL(URL(c.url, next).toString()).openConnection() as HttpURLConnection
        }
        if (c.responseCode != 200) throw IllegalStateException("download answered ${c.responseCode}")
        val total = c.contentLengthLong.coerceAtLeast(1)
        var done = 0L
        var last = -1
        c.inputStream.use { input ->
            file.outputStream().use { out ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    val pct = (done * 100 / total).toInt().coerceAtMost(100)
                    if (pct != last) { send(JSONObject().put("pct", pct)); last = pct }
                }
            }
        }
        return file
    }

    /** A PackageInstaller session; Android shows its own confirmation. Docs: Android/PackageInstaller. */
    private fun commit(apk: File) {
        val installer = activity.packageManager.packageInstaller
        val sessionId = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val action = "app.dholphin.tv.INSTALL_RESULT.$sessionId"
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                        PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(c::startActivity)
                            result("started")
                        }
                        // On success Android replaces and restarts this app, so the page is gone.
                        PackageInstaller.STATUS_SUCCESS -> Unit
                        else -> { result("failed"); runCatching { c.unregisterReceiver(this) } }
                    }
                }
            }
            val filter = IntentFilter(action)
            if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            else @Suppress("UnspecifiedRegisterReceiverFlag") activity.registerReceiver(receiver, filter)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(activity, sessionId, Intent(action).setPackage(activity.packageName), flags)
            session.commit(pi.intentSender)
        }
    }

    private fun result(r: String) = send(JSONObject().put("result", r))

    companion object {
        /** Where releases are published: tools/publish_android.sh. */
        const val RELEASES = "https://github.com/Gandalfoy63/dholphin-releases/releases/download/"
    }
}
