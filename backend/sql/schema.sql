-- E-class Analytics — MySQL schema
-- Run this once against your MySQL instance after creating the database.
--
-- Usage from MySQL CLI:
--   CREATE DATABASE eclass_analytics CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   USE eclass_analytics;
--   SOURCE /path/to/backend/sql/schema.sql;
--
-- Or from MySQL Workbench: open this file, set the default schema to eclass_analytics, run.
  
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS mcq_report;
DROP TABLE IF EXISTS video_usage;
DROP TABLE IF EXISTS login_history;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id             BIGINT       NOT NULL AUTO_INCREMENT UNIQUE,
  user_id        INT          NOT NULL PRIMARY KEY,
  enrollment_id  VARCHAR(64)  NULL,
  student_name   VARCHAR(255) NULL,
  email_id       VARCHAR(255) NULL,
  gender         VARCHAR(32)  NULL,
  user_kind      ENUM('Student','Teacher') NOT NULL DEFAULT 'Student',
  school         VARCHAR(255) NULL,
  division       VARCHAR(64)  NULL,
  UNIQUE KEY uq_enrollment (enrollment_id),
  KEY idx_school   (school),
  KEY idx_division (division),
  KEY idx_gender   (gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_history (
  id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  login_date      DATE         NULL,
  login_time      TIME         NULL,       -- wall-clock H:MM:SS, e.g. '12:23:04'
  logout_date     DATE         NULL,
  logout_time     TIME         NULL,       -- wall-clock H:MM:SS
  session_time    TIME         NULL,       -- duration H:MM:SS, e.g. '01:14:32'
  KEY idx_login_user (user_id),
  KEY idx_login_date (login_date),
  CONSTRAINT fk_login_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_usage (
  id                      BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id                 INT          NOT NULL,
  course                  VARCHAR(255) NULL,
  subject                 VARCHAR(255) NULL,
  chapter                 VARCHAR(255) NULL,
  content_name            VARCHAR(500) NULL,
  content_type            VARCHAR(64)  NULL,
  total_view_duration     TIME         NULL,          -- duration H:MM:SS, e.g. '00:04:19'
  total_view_count        INT          NULL DEFAULT 0,
  last_access_date        DATE         NULL,
  last_access_time        TIME         NULL,          -- wall-clock H:MM:SS
  KEY idx_video_user        (user_id),
  KEY idx_video_course      (course),
  KEY idx_video_subject     (subject),
  KEY idx_video_last_access (last_access_date),
  CONSTRAINT fk_video_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mcq_report (
  id                    BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id               INT          NOT NULL,
  course                VARCHAR(255) NULL,
  subject               VARCHAR(255) NULL,
  chapter               VARCHAR(255) NULL,
  total_question        INT          NULL DEFAULT 0,
  right_question_count  INT          NULL DEFAULT 0,
  total_marks           INT          NULL DEFAULT 0,
  marks_obtained        INT          NULL DEFAULT 0,
  percentage            DECIMAL(5,2) NULL DEFAULT 0,
  attempted_date        DATE         NULL,
  attempted_time        TIME         NULL,           -- wall-clock H:MM:SS
  time_spent            TIME         NULL,           -- duration H:MM:SS
  KEY idx_mcq_user      (user_id),
  KEY idx_mcq_course    (course),
  KEY idx_mcq_subject   (subject),
  KEY idx_mcq_attempted (attempted_date),
  CONSTRAINT fk_mcq_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
