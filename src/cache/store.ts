import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';


dotenv.config({ quiet: true });

const CACHE_DIR = process.env.CACHE_DIR || '.eclass-mcp/cache';

export const TTL = {
  COURSES: 60 * 24,      // 24 hours
  CONTENT: 60 * 6,       // 6 hours
  DEADLINES: 60 * 2,     // 2 hours
  ANNOUNCEMENTS: 60,     // 1 hour
  GRADES: 60 * 12,       // 12 hours
  FILES: 60 * 24 * 7,    // 7 days (parsed file text rarely changes)
};

interface CacheEntry<T> {
  expires_at: string;
  data: T;
}

class CacheStore {
  constructor() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  }

  get<T>(key: string): T | null {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);
      
      const now = new Date();
      const expiresAt = new Date(entry.expires_at);

      if (now > expiresAt) {
        this.invalidate(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.error(`Error reading cache for key "${key}":`, error);
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMinutes: number): void {
    const filePath = this.getFilePath(key);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    const entry: CacheEntry<T> = {
      expires_at: expiresAt.toISOString(),
      data: value,
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing cache for key "${key}":`, error);
    }
  }

  invalidate(key: string): void {
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Error invalidating cache for key "${key}":`, error);
      }
    }
  }

  clear(): void {
    if (!fs.existsSync(CACHE_DIR)) return;

    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}

export const cache = new CacheStore();
