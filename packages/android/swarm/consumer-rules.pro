# kotlinx.serialization: Serializer der eigenen Modelle behalten
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.claudewebui.swarm.**$$serializer { *; }
-keepclassmembers class com.claudewebui.swarm.** { *** Companion; }
-keepclasseswithmembers class com.claudewebui.swarm.** { kotlinx.serialization.KSerializer serializer(...); }

# Ktor und OkHttp
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
