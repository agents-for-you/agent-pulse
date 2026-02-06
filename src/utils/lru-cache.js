/**
 * @fileoverview LRU (Least Recently Used) cache implementation
 * @template K, V
 */
export class LRUCache {
  /**
   * @param {number} maxSize - Maximum cache size
   */
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    /** @type {Map<K, V>} */
    this.cache = new Map();
  }

  /**
   * Check if key exists
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get value
   * @param {K} key
   * @returns {V|undefined}
   */
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    // Refresh access order
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set value
   * @param {K} key
   * @param {V} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      // Only evict if maxSize > 0 (prevents undefined key when maxSize is 0)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    // Only set if maxSize > 0 or cache not at limit
    if (this.maxSize > 0 || this.cache.size < this.maxSize) {
      this.cache.set(key, value);
    }
  }

  /**
   * Add key (value is true)
   * @param {K} key
   */
  add(key) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      // Only evict if maxSize > 0 (prevents undefined key when maxSize is 0)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    // Only set if maxSize > 0 or cache not at limit
    if (this.maxSize > 0 || this.cache.size < this.maxSize) {
      this.cache.set(key, true);
    }
  }

  /**
   * Delete key
   * @param {K} key
   * @returns {boolean}
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get all entries
   * @returns {Array<[K, V]>}
   */
  entries() {
    return Array.from(this.cache.entries());
  }

  /**
   * Get all keys
   * @returns {K[]}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   * @returns {V[]}
   */
  values() {
    return Array.from(this.cache.values());
  }

  /**
   * Get size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}
