-- LocalGuide AI — esquema MySQL
-- Ejecutar como usuario con permisos CREATE DATABASE (o crear la DB manualmente).

-- Nombre sugerido en el VPS (mismo prefijo que retailso_autoque, etc.)
CREATE DATABASE IF NOT EXISTS retailso_aroundme
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE retailso_aroundme;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  language ENUM('es', 'en') NOT NULL DEFAULT 'es',
  interests JSON NOT NULL,
  food_preferences JSON NOT NULL,
  budget ENUM('bajo', 'medio', 'alto') NOT NULL DEFAULT 'medio',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  text TEXT NOT NULL,
  places_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_user_created (user_id, created_at),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_places (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  place_id VARCHAR(128) NULL,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(512) NULL,
  lat DECIMAL(10, 7) NULL,
  lng DECIMAL(10, 7) NULL,
  rating DECIMAL(3, 1) NULL,
  maps_url VARCHAR(1024) NULL,
  waze_url VARCHAR(1024) NULL,
  note TEXT NULL,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_saved_user (user_id, saved_at),
  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
