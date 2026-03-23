// mux-storage.js - Shared IndexedDB storage for large data transfer between contexts

const DB_NAME = 'VideoMuxDB';
const DB_VERSION = 1;
const STORE_NAME = 'muxData';

// Open or create the database
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// Store data for a mux operation
export async function storeMuxData(requestId, videoData, audioData) {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const data = {
            id: requestId,
            videoData: videoData,  // Uint8Array
            audioData: audioData,  // Uint8Array
            timestamp: Date.now()
        };
        
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        
        transaction.oncomplete = () => db.close();
    });
}

// Retrieve data for a mux operation
export async function getMuxData(requestId) {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.get(requestId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        
        transaction.oncomplete = () => db.close();
    });
}

// Store the mux result
export async function storeMuxResult(requestId, resultData) {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Get existing data and add result
        const getRequest = store.get(requestId);
        getRequest.onsuccess = () => {
            const data = getRequest.result || { id: requestId };
            data.resultData = resultData;  // Uint8Array
            data.completed = true;
            
            const putRequest = store.put(data);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
        
        transaction.oncomplete = () => db.close();
    });
}

// Get the mux result
export async function getMuxResult(requestId) {
    const data = await getMuxData(requestId);
    return data?.resultData;
}

// Delete mux data after processing
export async function deleteMuxData(requestId) {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.delete(requestId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        
        transaction.oncomplete = () => db.close();
    });
}

// Clear ALL mux data (used when no downloads are active)
export async function clearAllMuxData() {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.clear();
        request.onsuccess = () => {
            console.log("MuxDB cleared successfully.");
            resolve();
        };
        request.onerror = () => reject(request.error);
        
        transaction.oncomplete = () => db.close();
    });
}

// Clean up old entries (older than 1 hour)
export async function cleanupOldEntries() {
    const db = await openDatabase();
    const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.timestamp < cutoffTime) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
        request.onerror = () => reject(request.error);
        
        transaction.oncomplete = () => {
            db.close();
            resolve();
        };
    });
}
