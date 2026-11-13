-- =====================================================================
-- SETUP: tạo database, bảng, seed 1M stories + 500k comments, index
-- CẢNH BÁO: script xóa database hn_demo cũ (nếu có) rồi tạo lại
-- Chạy bằng CLI: mysql -u root -p < setup.sql
-- =====================================================================

DROP DATABASE IF EXISTS hn_demo;
CREATE DATABASE hn_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hn_demo;

-- ---------------------------------------------------------------------
-- PHẦN 1. SCHEMA
-- Chỉ tạo PRIMARY KEY trước, index tạo SAU khi seed để nạp dữ liệu nhanh
-- ---------------------------------------------------------------------
CREATE TABLE stories (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title        VARCHAR(255)    NOT NULL,
  url          VARCHAR(255)    NOT NULL,
  domain       VARCHAR(100)    NOT NULL,
  topic        VARCHAR(50)     NOT NULL,
  author       VARCHAR(50)     NOT NULL,
  points       INT UNSIGNED    NOT NULL DEFAULT 0,
  num_comments INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   DATETIME        NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE comments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id   BIGINT UNSIGNED NOT NULL,
  parent_id  BIGINT UNSIGNED NULL,          -- NULL = bình luận gốc
  author     VARCHAR(50)     NOT NULL,
  body       TEXT            NOT NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PHẦN 2. BẢNG PHỤ ĐỂ SINH SỐ 0..999999 (cross join 6 lần bảng 10 chữ số)
-- ---------------------------------------------------------------------
CREATE TABLE digits (d TINYINT NOT NULL PRIMARY KEY);
INSERT INTO digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);

-- ---------------------------------------------------------------------
-- PHẦN 3. SEED 1.000.000 STORIES
-- Nếu bị timeout/đầy log, tăng: SET GLOBAL innodb_buffer_pool_size / max_allowed_packet
-- hoặc chạy bằng CLI thay vì phpMyAdmin
-- ---------------------------------------------------------------------
SET autocommit = 0;
SET unique_checks = 0;
SET foreign_key_checks = 0;

INSERT INTO stories (title, url, domain, topic, author, points, num_comments, created_at)
SELECT
  CONCAT(t.adj, ' ', t.topic, ' ', t.noun, ' #', t.n),
  CONCAT('https://', t.domain, '/post/', t.n),
  t.domain,
  t.topic,
  CONCAT('user', FLOOR(RAND() * 20000)),
  t.points,
  FLOOR(t.points * RAND() * 0.5),
  NOW() - INTERVAL FLOOR(RAND() * 94608000) SECOND      -- trải đều 3 năm gần nhất
FROM (
  SELECT
    a.d + b.d*10 + c.d*100 + e.d*1000 + f.d*10000 + g.d*100000 AS n,
    ELT(1 + FLOOR(RAND()*8),
        'Show HN:', 'Why', 'How', 'Understanding', 'Building', 'Rethinking', 'Introducing', 'The case for') AS adj,
    ELT(1 + FLOOR(RAND()*10),
        'Rust', 'Python', 'Go', 'JavaScript', 'PostgreSQL', 'MySQL', 'AI', 'Linux', 'Security', 'Startups') AS topic,
    ELT(1 + FLOOR(RAND()*6),
        'performance', 'internals', 'in production', 'for beginners', 'at scale', 'explained') AS noun,
    ELT(1 + FLOOR(RAND()*10),
        'github.com', 'medium.com', 'nytimes.com', 'arxiv.org', 'blog.example.com',
        'dev.to', 'youtube.com', 'wikipedia.org', 'substack.com', 'news.ycombinator.com') AS domain,
    FLOOR(POW(RAND(), 4) * 2000) AS points               -- lệch phải: ít bài điểm cao, nhiều bài điểm thấp
  FROM digits a, digits b, digits c, digits e, digits f, digits g
) t;

COMMIT;

-- ---------------------------------------------------------------------
-- PHẦN 4. SEED 500.000 COMMENTS (bình luận gốc, gắn ngẫu nhiên vào stories)
-- ---------------------------------------------------------------------
INSERT INTO comments (story_id, parent_id, author, body, created_at)
SELECT
  1 + FLOOR(RAND() * 1000000),
  NULL,
  CONCAT('user', FLOOR(RAND() * 20000)),
  CONCAT('Comment ', t.n, ': ', ELT(1 + FLOOR(RAND()*4),
         'Great article.', 'I disagree with this approach.', 'Has anyone benchmarked this?', 'Thanks for sharing.')),
  NOW() - INTERVAL FLOOR(RAND() * 94608000) SECOND
FROM (
  SELECT a.d + b.d*10 + c.d*100 + e.d*1000 + f.d*10000 + g.d*100000 AS n
  FROM digits a, digits b, digits c, digits e, digits f, digits g
) t
WHERE t.n < 500000;

COMMIT;
SET unique_checks = 1;
SET foreign_key_checks = 1;
SET autocommit = 1;

-- ---------------------------------------------------------------------
-- PHẦN 5. INDEX (tạo sau khi seed)
-- Lưu ý: chạy các truy vấn benchmark TRƯỚC khi tạo index để so sánh "có/không có index"
-- ---------------------------------------------------------------------
ALTER TABLE stories
  ADD INDEX idx_created_id   (created_at, id),         -- keyset: mới nhất
  ADD INDEX idx_points_id    (points, id),             -- keyset: điểm cao nhất
  ADD INDEX idx_domain_cre   (domain, created_at, id), -- lọc theo domain + keyset
  ADD INDEX idx_topic_cre    (topic, created_at, id),  -- lọc theo chủ đề + keyset
  ADD FULLTEXT INDEX ft_title (title);                 -- tìm kiếm cho chatbot

ALTER TABLE comments
  ADD INDEX idx_story_cre (story_id, created_at, id),
  ADD INDEX idx_parent    (parent_id);

ANALYZE TABLE stories, comments;