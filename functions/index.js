const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * 🔔 Trigger on Firestore: notification_queue/{notifId}
 * Sends broadcast FCM notification to topic "all_users" and registers the result in Firestore.
 */
exports.processNotificationQueue = onDocumentCreated("notification_queue/{notifId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the event");
    return;
  }

  const notifData = snapshot.data();
  const notifId = event.params.notifId;

  // Prevent duplicate sending (idempotency check)
  if (notifData.status === "sent" || notifData.sentAt) {
    console.log(`Notification ${notifId} already processed, skipping.`);
    return;
  }

  const title = notifData.title || "BLACK ANIME";
  const body = notifData.body || "";
  const topic = notifData.topic || "all_users";
  const imageUrl = notifData.imageUrl || "";

  console.log(`[FCM Broadcast] Processing notification: "${title}" for topic: "${topic}"`);

  const message = {
    topic: topic,
    notification: {
      title: title,
      body: body,
      ...(imageUrl ? { imageUrl: imageUrl } : {})
    },
    data: {
      title: String(title),
      body: String(body),
      contentTitle: String(notifData.contentTitle || ""),
      firebaseId: String(notifData.firebaseId || ""),
      episode: String(notifData.episode || ""),
      episodeIndex: String(notifData.episodeIndex || ""),
      page: String(notifData.page || "details"),
      action: String(notifData.action || "play"),
      imageUrl: String(imageUrl),
      url: String(notifData.url || "")
    },
    android: {
      priority: "high",
      notification: {
        channelId: "black_anime_notifications",
        defaultSound: true,
        defaultVibrateTimings: true,
        ...(imageUrl ? { imageUrl: imageUrl } : {})
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`[FCM Broadcast] Successfully sent message to topic ${topic}:`, response);

    await snapshot.ref.update({
      status: "sent",
      fcmMessageId: response,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      error: null
    });
  } catch (error) {
    console.error(`[FCM Broadcast] Failed to send message to topic ${topic}:`, error);

    await snapshot.ref.update({
      status: "failed",
      errorMessage: error.message || String(error),
      failedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
});

/**
 * 🔒 HTTPS Endpoint for authenticated admin notification sending
 */
exports.sendAdminBroadcast = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
    return;
  }

  const { adminKey, title, body, imageUrl, firebaseId, episode, contentTitle, action, page } = req.body;

  // Verify Admin Code (Default code: hamza2009)
  if (!adminKey || adminKey.toLowerCase().trim() !== "hamza2009") {
    res.status(403).json({ success: false, error: "Unauthorized: Invalid admin key" });
    return;
  }

  if (!title || !body) {
    res.status(400).json({ success: false, error: "Missing required fields: title or body" });
    return;
  }

  const message = {
    topic: "all_users",
    notification: {
      title: title,
      body: body,
      ...(imageUrl ? { imageUrl: imageUrl } : {})
    },
    data: {
      title: String(title),
      body: String(body),
      contentTitle: String(contentTitle || ""),
      firebaseId: String(firebaseId || ""),
      episode: String(episode || ""),
      page: String(page || "details"),
      action: String(action || "play"),
      imageUrl: String(imageUrl || "")
    },
    android: {
      priority: "high",
      notification: {
        channelId: "black_anime_notifications",
        defaultSound: true,
        defaultVibrateTimings: true,
        ...(imageUrl ? { imageUrl: imageUrl } : {})
      }
    }
  };

  try {
    const messageId = await admin.messaging().send(message);
    console.log("[HTTPS FCM] Broadcast sent successfully:", messageId);

    // Also record in notification_queue for dashboard logging
    await admin.firestore().collection("notification_queue").add({
      topic: "all_users",
      title: title,
      body: body,
      imageUrl: imageUrl || "",
      firebaseId: firebaseId || "",
      contentTitle: contentTitle || "",
      episode: episode || "",
      page: page || "details",
      action: action || "play",
      status: "sent",
      fcmMessageId: messageId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "https_admin_endpoint"
    });

    res.status(200).json({
      success: true,
      messageId: messageId,
      targetTopic: "all_users"
    });
  } catch (error) {
    console.error("[HTTPS FCM] Error sending broadcast:", error);
    res.status(500).json({
      success: false,
      error: error.message || String(error)
    });
  }
});
