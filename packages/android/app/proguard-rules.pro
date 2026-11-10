# Ktor
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**

# Socket.IO
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.claudewebui.app.**$$serializer { *; }
-keepclassmembers class com.claudewebui.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.claudewebui.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Room
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# Markwon
-keep class io.noties.markwon.** { *; }
-dontwarn io.noties.markwon.**

# OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**

# Koin
-keep class org.koin.** { *; }
-dontwarn org.koin.**
-keepnames class * extends org.koin.core.module.Module

# Coil (image loading)
-keep class coil.** { *; }
-dontwarn coil.**
-keep interface coil.** { *; }

# Dynamic UI custom tiles: the WebView bridge (DynamicUiWidget.kt) is called by name from JS.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
