<?php
declare(strict_types=1);

const DB_HOST = '127.0.0.1';
const DB_PORT = 3306;
const DB_NAME = 'hn_demo';
const DB_USER = 'root';
const DB_PASS = '';

const DOMAINS = [
    'github.com', 'medium.com', 'nytimes.com', 'arxiv.org', 'blog.example.com',
    'dev.to', 'youtube.com', 'wikipedia.org', 'substack.com', 'news.ycombinator.com',
];
const TOPICS = [
    'Rust', 'Python', 'Go', 'JavaScript', 'PostgreSQL', 'MySQL', 'AI', 'Linux', 'Security', 'Startups',
];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4',
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {
            json_error('Không kết nối được MySQL. Kiểm tra WAMP đã chạy và đã import database/hn_demo.sql chưa. (' . $e->getMessage() . ')', 500);
        }
    }
    return $pdo;
}

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $status = 400): void
{
    json_out(['error' => $message], $status);
}

function run_query(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    foreach ($params as $name => $value) {
        $type = is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR;
        $stmt->bindValue($name, $value, $type);
    }
    $stmt->execute();
    return $stmt;
}

function timed(callable $fn): array
{
    $start  = microtime(true);
    $result = $fn();
    return [$result, round((microtime(true) - $start) * 1000, 1)];
}

function int_param(string $key, int $default, int $min, int $max): int
{
    $value = isset($_GET[$key]) ? (int)$_GET[$key] : $default;
    return max($min, min($max, $value));
}

function sort_param(): string
{
    return (($_GET['sort'] ?? 'new') === 'top') ? 'top' : 'new';
}

function domain_param(): ?string
{
    $domain = $_GET['domain'] ?? '';
    return in_array($domain, DOMAINS, true) ? $domain : null;
}

function story_columns(): string
{
    return 'id, title, url, domain, topic, author, points, num_comments, created_at,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_s';
}

function format_story(array $row): array
{
    return [
        'id'           => (int)$row['id'],
        'title'        => $row['title'],
        'url'          => $row['url'],
        'domain'       => $row['domain'],
        'topic'        => $row['topic'],
        'author'       => $row['author'],
        'points'       => (int)$row['points'],
        'num_comments' => (int)$row['num_comments'],
        'created_at'   => $row['created_at'],
        'age_s'        => (int)$row['age_s'],
    ];
}

function squash_sql(string $sql): string
{
    return trim(preg_replace('/\s+/', ' ', $sql));
}
