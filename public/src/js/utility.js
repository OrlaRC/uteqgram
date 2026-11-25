// Abre (o crea) la base de datos local 'posts-store' en IndexedDB con dos almacenes:
// 'posts' guarda los posts de Firebase y 'sync-posts' los posts pendientes de enviar.
// Se usa la versión 2 para que los navegadores que ya tenían la versión 1 creen 'sync-posts'.
var dbPromise = idb.open('posts-store', 2, function (db) {
  if (!db.objectStoreNames.contains('posts')) {
    db.createObjectStore('posts', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('sync-posts')) {
    db.createObjectStore('sync-posts', { keyPath: 'id' });
  }
});

// Guarda (o actualiza) un registro en el almacén indicado
function writeData(st, data) {
  return dbPromise
    .then(function (db) {
      var tx = db.transaction(st, 'readwrite');
      var store = tx.objectStore(st);
      store.put(data);
      return tx.complete;
    });
}

// Lee todos los registros del almacén indicado
function readAllData(st) {
  return dbPromise
    .then(function (db) {
      var tx = db.transaction(st, 'readonly');
      var store = tx.objectStore(st);
      return store.getAll();
    });
}

// Borra todos los registros del almacén indicado
function clearAllData(st) {
  return dbPromise
    .then(function (db) {
      var tx = db.transaction(st, 'readwrite');
      var store = tx.objectStore(st);
      store.clear();
      return tx.complete;
    });
}

// Borra un solo registro del almacén indicado usando su id
function deleteItemFromData(st, id) {
  return dbPromise
    .then(function (db) {
      var tx = db.transaction(st, 'readwrite');
      var store = tx.objectStore(st);
      store.delete(id);
      return tx.complete;
    })
    .then(function () {
      console.log('Item deleted!');
    });
}
