package sk.ludovka.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Ľudovka — thin native shell around the offline web app in assets/www.
 * No network permission is declared anywhere: everything the app shows comes from
 * files bundled inside the APK, and everything the user adds is stored locally on
 * the device via the WebView's IndexedDB.
 */
public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private volatile boolean canGoBackInApp = false;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (filePathCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == Activity.RESULT_OK
                        && result.getData() != null
                        && result.getData().getData() != null) {
                    results = new Uri[]{result.getData().getData()};
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"
                });
                try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Vyber CSV súbor"));
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (canGoBackInApp) {
            webView.evaluateJavascript("window.appGoBack && window.appGoBack();", null);
        } else {
            // Send the app to background instead of killing the WebView/JS state,
            // matching how most Android apps behave on the root screen.
            moveTaskToBack(true);
        }
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void setCanGoBack(final boolean value) {
            canGoBackInApp = value;
        }

        @JavascriptInterface
        public void saveTextFile(final String filename, final String content, final String mime) {
            new Thread(() -> {
                final boolean ok = writeToDownloads(filename, content, mime);
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        ok ? ("Uložené do priečinka Downloads: " + filename) : "Uloženie súboru zlyhalo",
                        Toast.LENGTH_LONG
                ).show());
            }).start();
        }
    }

    private boolean writeToDownloads(String filename, String content, String mime) {
        try {
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            String mimeType = (mime == null || mime.isEmpty()) ? "text/csv" : mime;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item == null) return false;
                try (OutputStream out = getContentResolver().openOutputStream(item)) {
                    if (out == null) return false;
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(item, values, null, null);
                return true;
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return false;
                File out = new File(dir, filename);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                }
                return true;
            }
        } catch (Exception e) {
            Log.e("Ludovka", "saveTextFile failed", e);
            return false;
        }
    }
}
