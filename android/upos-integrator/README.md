# U-POS Integrator for Android

This WebView wrapper loads `https://app.u-pos.uz/installer` and exposes the
`UposAndroidAudio` JavaScript bridge. The bridge places Android in voice-call
mode and switches between the earpiece and loudspeaker with `AudioManager`.

Build the release APK with:

```powershell
.\gradlew.bat clean assembleRelease
```

Release APKs must be signed with the persistent U-POS signing key before they
are copied to `pyweb/upos/static/downloads/upos-integrator.apk`. Never commit
the signing key or its password.

The Android package is `uz.upos.integrator`. Keep the same application ID and
signing key for every release so Android can install updates over the existing
application.
