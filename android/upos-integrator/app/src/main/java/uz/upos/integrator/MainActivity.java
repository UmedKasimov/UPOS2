package uz.upos.integrator;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowManager;
import android.widget.Toast;

import java.util.List;

public class MainActivity extends Activity {
    private static final int AUDIO_PERMISSION_REQUEST = 210;
    private static final String APP_URL = "https://app.u-pos.uz/installer?native=android&native_v=1";

    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private AudioBridge audioBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
        audioBridge = new AudioBridge(this);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setUserAgentString(settings.getUserAgentString() + " UPosIntegratorAndroid/1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(audioBridge, "UposAndroidAudio");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme())
                    && "app.u-pos.uz".equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermission == request) pendingWebPermission = null;
            }
        });

        if (savedInstanceState == null) webView.loadUrl(APP_URL);
        else webView.restoreState(savedInstanceState);
    }

    private void handleWebPermission(PermissionRequest request) {
        boolean requestsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                requestsAudio = true;
                break;
            }
        }
        Uri origin = request.getOrigin();
        if (!requestsAudio
            || !"https".equalsIgnoreCase(origin.getScheme())
            || !"app.u-pos.uz".equalsIgnoreCase(origin.getHost())) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        pendingWebPermission = request;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_PERMISSION_REQUEST || pendingWebPermission == null) return;
        PermissionRequest request = pendingWebPermission;
        pendingWebPermission = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "Разрешите доступ к микрофону для SIP-звонков", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        audioBridge.endCall();
        webView.destroy();
        super.onDestroy();
    }

    public static final class AudioBridge {
        private final Activity activity;
        private final AudioManager audioManager;
        private AudioFocusRequest focusRequest;
        private boolean speakerEnabled;
        private boolean callActive;
        private int routeGeneration;

        AudioBridge(Activity activity) {
            this.activity = activity;
            this.audioManager = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
        }

        @JavascriptInterface
        public String getVersion() {
            return "1";
        }

        @JavascriptInterface
        public boolean beginCall() {
            activity.runOnUiThread(() -> {
                if (!callActive) requestAudioFocus();
                callActive = true;
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                applyRoute(false);
            });
            return true;
        }

        @JavascriptInterface
        public boolean setSpeaker(boolean enabled) {
            speakerEnabled = enabled;
            activity.runOnUiThread(() -> applyRoute(enabled));
            return true;
        }

        @JavascriptInterface
        public boolean isSpeakerEnabled() {
            return speakerEnabled;
        }

        @JavascriptInterface
        public void endCall() {
            activity.runOnUiThread(() -> {
                routeGeneration++;
                speakerEnabled = false;
                callActive = false;
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    audioManager.clearCommunicationDevice();
                } else {
                    audioManager.setSpeakerphoneOn(false);
                }
                audioManager.setMode(AudioManager.MODE_NORMAL);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                    audioManager.abandonAudioFocusRequest(focusRequest);
                }
            });
        }

        private void requestAudioFocus() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(focusChange -> { })
                    .build();
                audioManager.requestAudioFocus(focusRequest);
            } else {
                audioManager.requestAudioFocus(
                    focusChange -> { },
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                );
            }
        }

        private void route(boolean speaker) {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.setMicrophoneMute(false);
            audioManager.setSpeakerphoneOn(speaker);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                int targetType = speaker
                    ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                for (AudioDeviceInfo device : devices) {
                    if (device.getType() == targetType) {
                        audioManager.setCommunicationDevice(device);
                        return;
                    }
                }
            }
        }

        private void applyRoute(boolean speaker) {
            speakerEnabled = speaker;
            final int generation = ++routeGeneration;
            route(speaker);
            // Chromium configures its WebRTC audio track asynchronously and may
            // briefly reset AudioManager. Reassert the requested route afterwards.
            activity.getWindow().getDecorView().postDelayed(() -> {
                if (generation == routeGeneration) route(speakerEnabled);
            }, 300);
            activity.getWindow().getDecorView().postDelayed(() -> {
                if (generation == routeGeneration) route(speakerEnabled);
            }, 1200);
        }
    }
}
