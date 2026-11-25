// Guarda el evento de instalación para mostrarlo cuando el usuario abra el formulario
var deferredPrompt;
var enableNotificationsButtons = document.querySelectorAll('.enable-notifications');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(function () {
      console.log('Service worker registrado');
    })
    .catch(function (err) {
      console.log('Error al registrar el service worker', err);
    });
}

// Se dispara cuando el navegador ofrece instalar la app (requiere un manifest.json)
window.addEventListener('beforeinstallprompt', function (event) {
  console.log('beforeinstallprompt fired');
  event.preventDefault();
  deferredPrompt = event;
  return false;
});

// ---------- Notificaciones ----------
// Muestra una notificación de confirmación a través del Service Worker
function displayConfirmNotification() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.ready.then(function (swreg) {
    swreg.showNotification('¡Notificaciones activadas!', {
      body: 'Te avisaremos cuando tus publicaciones se sincronicen.',
      icon: '/src/images/icons/app-icon-96x96.png',
      badge: '/src/images/icons/app-icon-96x96.png',
      lang: 'es-MX',
      vibrate: [100, 50, 200],
      tag: 'confirm-notification'
    });
  });
}

function askForNotificationPermission() {
  Notification.requestPermission(function (result) {
    console.log('Permiso de notificaciones:', result);
    if (result !== 'granted') {
      console.log('No se concedió el permiso de notificaciones');
      return;
    }
    hideNotificationButtons();
    displayConfirmNotification();
  });
}

function hideNotificationButtons() {
  for (var i = 0; i < enableNotificationsButtons.length; i++) {
    enableNotificationsButtons[i].style.display = 'none';
  }
}

if ('Notification' in window && 'serviceWorker' in navigator) {
  if (Notification.permission === 'granted') {
    hideNotificationButtons();
  }
  for (var i = 0; i < enableNotificationsButtons.length; i++) {
    enableNotificationsButtons[i].addEventListener('click', askForNotificationPermission);
  }
} else {
  hideNotificationButtons();
}

// ---------- Indicador de conexión ----------
// Muestra una franja cuando el dispositivo se queda sin internet
var offlineBanner = document.querySelector('#offline-banner');

function updateConnectionStatus() {
  if (!offlineBanner) {
    return;
  }
  offlineBanner.style.display = navigator.onLine ? 'none' : 'block';
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();
