var shareImageButton = document.querySelector('#share-image-button');
var createPostArea = document.querySelector('#create-post');
var closeCreatePostModalButton = document.querySelector('#close-create-post-modal-btn');
var sharedMomentsArea = document.querySelector('#shared-moments');
var form = document.querySelector('form');
var titleInput = document.querySelector('#title');
var locationInput = document.querySelector('#location');
var feedMeta = document.querySelector('#feed-meta');

// ---------- Datos locales (localStorage) ----------
// Se guarda el borrador del formulario y la fecha de la última descarga del feed.
// localStorage es síncrono y solo admite texto, por eso se usa para datos pequeños;
// los posts completos se guardan en IndexedDB.
var DRAFT_KEY = 'uteqgram-draft';
var LAST_SYNC_KEY = 'uteqgram-last-sync';

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    title: titleInput.value,
    location: locationInput.value
  }));
}

function restoreDraft() {
  var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  if (!draft) {
    return;
  }
  titleInput.value = draft.title || '';
  locationInput.value = draft.location || '';
  // Material Design Lite necesita saber que el campo tiene texto para subir la etiqueta
  [titleInput, locationInput].forEach(function(input) {
    if (input.value && input.parentNode.MaterialTextfield) {
      input.parentNode.MaterialTextfield.checkDirty();
    } else if (input.value) {
      input.parentNode.classList.add('is-dirty');
    }
  });
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

titleInput.addEventListener('input', saveDraft);
locationInput.addEventListener('input', saveDraft);
window.addEventListener('load', restoreDraft);

// Muestra de dónde vienen los datos y cuándo se descargaron por última vez
function showFeedMeta(source) {
  if (!feedMeta) {
    return;
  }
  var lastSync = localStorage.getItem(LAST_SYNC_KEY);
  var text = 'Origen de los datos: ' + source;
  if (lastSync) {
    text += ' · última actualización desde la red: ' + new Date(lastSync).toLocaleString('es-MX');
  }
  feedMeta.textContent = text;
}

function openCreatePostModal() {
  // createPostArea.style.display = 'block';
  createPostArea.style.transform = 'translateY(0)';
  if (deferredPrompt) {
    deferredPrompt.prompt();

    deferredPrompt.userChoice.then(function(choiceResult) {
      console.log(choiceResult.outcome);

      if (choiceResult.outcome === 'dismissed') {
        console.log('User cancelled installation');
      } else {
        console.log('User added to home screen');
      }
    });

    deferredPrompt = null;
  }
}

function closeCreatePostModal() {
  // createPostArea.style.display = 'none';
  createPostArea.style.transform = 'translateY(100vh)';
}

shareImageButton.addEventListener('click', openCreatePostModal);

closeCreatePostModalButton.addEventListener('click', closeCreatePostModal);

function clearCards() {
  while (sharedMomentsArea.hasChildNodes()) {
    sharedMomentsArea.removeChild(sharedMomentsArea.lastChild);
  }
}

function createCard(data) {
  var cardWrapper = document.createElement('div');
  cardWrapper.className = 'shared-moment-card mdl-card mdl-shadow--2dp';
  var cardTitle = document.createElement('div');
  cardTitle.className = 'mdl-card__title';
  cardTitle.style.backgroundImage = 'url(' + data.image + ')';
  cardTitle.style.backgroundSize = 'cover';
  cardTitle.style.height = '180px';
  cardWrapper.appendChild(cardTitle);
  var cardTitleTextElement = document.createElement('h2');
  cardTitleTextElement.style.color = 'white';
  cardTitleTextElement.className = 'mdl-card__title-text';
  cardTitleTextElement.textContent = data.title;
  cardTitle.appendChild(cardTitleTextElement);
  var cardSupportingText = document.createElement('div');
  cardSupportingText.className = 'mdl-card__supporting-text';
  cardSupportingText.textContent = data.location;
  cardSupportingText.style.textAlign = 'center';
  cardWrapper.appendChild(cardSupportingText);
  componentHandler.upgradeElement(cardWrapper);
  sharedMomentsArea.appendChild(cardWrapper);
}

function updateUI(data) {
  clearCards();
  // Los id son fechas ISO: se muestra primero el post más reciente
  // (los que no son fecha, como los posts de prueba, quedan al final)
  data.sort(function(a, b) {
    return (Date.parse(b.id) || 0) - (Date.parse(a.id) || 0);
  });
  for (var i = 0; i < data.length; i++) {
    createCard(data[i]);
  }
}

var url = 'https://uteq-test-e2e4b-default-rtdb.firebaseio.com/post.json';
var networkDataReceived = false;

// Descarga los posts de Firebase y los pinta en el feed
function loadPosts() {
  return fetch(url)
    .then(function(res) {
      return res.json();
    })
    .then(function(data) {
      networkDataReceived = true;
      console.log('From web', data);
      var dataArray = [];
      for (var key in data) {
        dataArray.push(data[key]);
      }
      updateUI(dataArray);
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      showFeedMeta('red (Firebase)');
    })
    .catch(function(err) {
      console.log('Sin conexión, se usan los datos de IndexedDB', err);
    });
}

loadPosts();

// Si quedaron posts pendientes (creados sin internet), se vuelve a pedir la
// sincronización al abrir la app y cada vez que regresa la conexión.
function retryPendingPosts() {
  if (!('serviceWorker' in navigator && 'SyncManager' in window && 'indexedDB' in window)) {
    return;
  }
  readAllData('sync-posts')
    .then(function(pending) {
      if (pending.length > 0) {
        console.log('Posts pendientes de enviar:', pending.length);
        return navigator.serviceWorker.ready.then(function(sw) {
          return sw.sync.register('sync-new-posts');
        });
      }
    })
    .catch(function(err) {
      console.log(err);
    });
}

retryPendingPosts();
window.addEventListener('online', retryPendingPosts);

// Cuando el service worker termina de enviar los posts, se recarga el feed
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function(event) {
    if (event.data === 'posts-synced') {
      loadPosts();
    }
  });
}

if ('indexedDB' in window) {
  readAllData('posts')
    .then(function(data) {
      if (!networkDataReceived) {
        console.log('From IndexedDB', data);
        updateUI(data);
        showFeedMeta('IndexedDB (sin conexión)');
      }
    });
}

// Envía el post directamente a Firebase (para navegadores sin Background Sync)
function sendData() {
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      id: new Date().toISOString(),
      title: titleInput.value,
      location: locationInput.value,
      image: '/src/images/sf-boat.jpg'
    })
  })
    .then(function(res) {
      console.log('Sent data', res);
      clearDraft();
      loadPosts();
    });
}

form.addEventListener('submit', function(event) {
  event.preventDefault();

  if (titleInput.value.trim() === '' || locationInput.value.trim() === '') {
    alert('Por favor escribe un título y una ubicación.');
    return;
  }

  closeCreatePostModal();

  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then(function(sw) {
        var post = {
          id: new Date().toISOString(),
          title: titleInput.value,
          location: locationInput.value
        };
        writeData('sync-posts', post)
          .then(function() {
            return sw.sync.register('sync-new-posts');
          })
          .then(function() {
            clearDraft();
            form.reset();
            var snackbarContainer = document.querySelector('#confirmation-toast');
            var data = {message: 'Tu publicación se guardó y se enviará en cuanto haya conexión.'};
            snackbarContainer.MaterialSnackbar.showSnackbar(data);
          })
          .catch(function(err) {
            console.log(err);
          });
      });
  } else {
    sendData();
  }
});
