<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

const CHAT_PAGE = 5;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Dùng phương thức POST.', 405);
}

$input   = json_decode((string)file_get_contents('php://input'), true);
$message = trim((string)($input['message'] ?? ''));
$state   = is_array($input['state'] ?? null) ? $input['state'] : null;

if ($message === '') {
    json_error('Tin nhắn trống.');
}
if (mb_strlen($message) > 200) {
    json_error('Tin nhắn quá dài (tối đa 200 ký tự).');
}

/** Bỏ dấu tiếng Việt + chữ thường để so khớp từ khóa dễ hơn. */
function fold(string $text): string
{
    static $map = null;
    if ($map === null) {
        $from = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
        $to   = str_repeat('a', 17) . str_repeat('e', 11) . str_repeat('i', 5)
              . str_repeat('o', 17) . str_repeat('u', 11) . str_repeat('y', 5) . 'd';
        $map  = array_combine(mb_str_split($from), mb_str_split($to));
    }
    return strtr(mb_strtolower($text), $map);
}

function has(string $haystack, array $needles): bool
{
    foreach ($needles as $n) {
        if (preg_match('/(^|\W)' . preg_quote($n, '/') . '(\W|$)/u', $haystack)) {
            return true;
        }
    }
    return false;
}

function detect_topic(string $t): ?string
{
    $aliases = [
        'Rust' => ['rust'], 'Python' => ['python'], 'Go' => ['go', 'golang'],
        'JavaScript' => ['javascript', 'js'], 'PostgreSQL' => ['postgresql', 'postgres'],
        'MySQL' => ['mysql'], 'AI' => ['ai', 'tri tue nhan tao'], 'Linux' => ['linux'],
        'Security' => ['security', 'bao mat'], 'Startups' => ['startups', 'startup'],
    ];
    foreach ($aliases as $topic => $words) {
        if (has($t, $words)) {
            return $topic;
        }
    }
    return null;
}

function detect_domain(string $t): ?string
{
    $short = [
        'github.com' => ['github'], 'medium.com' => ['medium'], 'nytimes.com' => ['nytimes'],
        'arxiv.org' => ['arxiv'], 'blog.example.com' => ['blog.example.com'], 'dev.to' => ['dev.to'],
        'youtube.com' => ['youtube'], 'wikipedia.org' => ['wikipedia'], 'substack.com' => ['substack'],
        'news.ycombinator.com' => ['news.ycombinator.com'],
    ];
    foreach ($short as $domain => $words) {
        if (has($t, array_merge([$domain], $words))) {
            return $domain;
        }
    }
    return null;
}

function suggestions(): array
{
    return [
        'Top bài Rust tuần này',
        'Bài mới nhất về PostgreSQL',
        'Bài trên github.com điểm cao nhất',
        'Tìm: scale performance',
        'Thống kê theo chủ đề',
    ];
}

function reply(array $data): void
{
    json_out($data + ['items' => [], 'table' => null, 'suggestions' => [], 'state' => null,
                       'query_ms' => null, 'sql' => null, 'intent' => null]);
}

$t = fold($message);

if (has($t, ['hi', 'hello', 'xin chao', 'chao', 'help', 'giup', 'huong dan', 'lam duoc gi'])) {
    reply([
        'intent'      => 'help',
        'reply'       => 'Chào bạn! Mình có thể tìm trong 1.000.000 bài viết. Hãy thử nói theo cách tự nhiên, ví dụ như các gợi ý bên dưới.',
        'suggestions' => suggestions(),
    ]);
}

$isMore = mb_strlen($t) <= 14 && has($t, ['them', 'xem them', 'tiep', 'more', 'next']);
if ($isMore && !($state && isset($state['kind']))) {
    reply([
        'intent'      => 'help',
        'reply'       => 'Chưa có kết quả nào để xem thêm. Hãy hỏi một câu trước nhé.',
        'suggestions' => suggestions(),
    ]);
}
if ($isMore) {
    $query = $state;
    $query['offset'] = (int)($state['offset'] ?? 0) + CHAT_PAGE;
} else {
    $query = null;
}

if ($query === null && has($t, ['thong ke', 'bao nhieu', 'dem', 'count', 'statistics'])) {
    $topic = detect_topic($t);
    if ($topic !== null) {
        $sql = 'SELECT COUNT(*) AS n, ROUND(AVG(points), 1) AS avg_points FROM stories WHERE topic = :topic';
        [$row, $ms] = timed(fn() => run_query($sql, [':topic' => $topic])->fetch());
        reply([
            'intent'      => 'stats',
            'reply'       => "Chủ đề {$topic} có " . number_format((int)$row['n']) . ' bài, điểm trung bình ' . $row['avg_points'] . '.',
            'query_ms'    => $ms,
            'sql'         => squash_sql($sql),
            'suggestions' => ["Top bài {$topic} tuần này", "Bài mới nhất về {$topic}", 'Thống kê theo chủ đề'],
        ]);
    }
    $sql = 'SELECT topic, COUNT(*) AS n FROM stories GROUP BY topic ORDER BY n DESC';
    [$rows, $ms] = timed(fn() => run_query($sql)->fetchAll());
    reply([
        'intent'      => 'stats',
        'reply'       => 'Số bài theo từng chủ đề:',
        'table'       => array_map(fn($r) => ['label' => $r['topic'], 'value' => number_format((int)$r['n'])], $rows),
        'query_ms'    => $ms,
        'sql'         => squash_sql($sql),
        'suggestions' => ['Top bài Rust tuần này', 'Bài mới nhất về AI'],
    ]);
}

if ($query === null) {
    $topic  = detect_topic($t);
    $domain = detect_domain($t);
    $period = null;
    if (has($t, ['hom nay', '24h'])) {
        $period = 'day';
    } elseif (has($t, ['tuan', 'tuan nay', 'week'])) {
        $period = 'week';
    } elseif (has($t, ['thang', 'thang nay', 'month'])) {
        $period = 'month';
    }
    $sortTop = has($t, ['top', 'hot', 'diem cao', 'noi bat', 'nhieu diem', 'hay nhat', 'pho bien', 'best']);

    if ($topic !== null || $domain !== null || $period !== null || $sortTop) {
        $query = [
            'kind'   => 'filter',
            'topic'  => $topic,
            'domain' => $domain,
            'period' => $period,
            'sort'   => $sortTop ? 'top' : 'new',
            'offset' => 0,
        ];
    } else {
        $stop  = ['tim', 'kiem', 'bai', 'viet', 've', 'cho', 'toi', 'nhung', 'cac', 'nao', 'co', 'search', 'find'];
        $words = preg_split('/[^a-z0-9]+/', preg_replace('/^(tim|search|find)\s*:?\s*/', '', $t), -1, PREG_SPLIT_NO_EMPTY);
        $words = array_values(array_filter($words, fn($w) => !in_array($w, $stop, true)));
        $q     = implode(' ', $words);
        if ($q === '') {
            reply([
                'intent'      => 'help',
                'reply'       => 'Mình chưa hiểu ý bạn. Hãy thử một trong các gợi ý này nhé.',
                'suggestions' => suggestions(),
            ]);
        }
        $query = ['kind' => 'search', 'q' => $q, 'offset' => 0];
    }
}

$offset = (int)($query['offset'] ?? 0);

if ($query['kind'] === 'search') {
    $q = (string)$query['q'];
    $hasUsableToken = (bool)array_filter(explode(' ', $q), fn($w) => strlen($w) >= 3);
    if (!$hasUsableToken) {
        reply([
            'intent'      => 'search',
            'reply'       => 'Từ khóa quá ngắn để tìm toàn văn (cần từ 3 ký tự trở lên). Bạn thử từ khóa dài hơn nhé.',
            'suggestions' => suggestions(),
        ]);
    }
    $sql = 'SELECT ' . story_columns() . ', MATCH(title) AGAINST(:q1) AS score
            FROM stories WHERE MATCH(title) AGAINST(:q2 IN NATURAL LANGUAGE MODE)
            ORDER BY score DESC, id DESC LIMIT :limit OFFSET :offset';
    $params = [':q1' => $q, ':q2' => $q, ':limit' => CHAT_PAGE + 1, ':offset' => $offset];
    $label  = "tìm \"{$q}\"";
} else {
    $conds  = [];
    $params = [];
    $parts  = [];
    if (!empty($query['topic'])) {
        $conds[] = 'topic = :topic';
        $params[':topic'] = $query['topic'];
        $parts[] = 'chủ đề ' . $query['topic'];
    }
    if (!empty($query['domain'])) {
        $conds[] = 'domain = :domain';
        $params[':domain'] = $query['domain'];
        $parts[] = 'từ ' . $query['domain'];
    }
    $periods = ['day' => ['1 DAY', 'hôm nay'], 'week' => ['7 DAY', 'tuần này'], 'month' => ['30 DAY', 'tháng này']];
    if (!empty($query['period']) && isset($periods[$query['period']])) {
        $conds[] = 'created_at >= NOW() - INTERVAL ' . $periods[$query['period']][0];
        $parts[] = $periods[$query['period']][1];
    }
    $order   = $query['sort'] === 'top' ? 'points DESC, id DESC' : 'created_at DESC, id DESC';
    $where   = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';
    $sql     = 'SELECT ' . story_columns() . " FROM stories $where ORDER BY $order LIMIT :limit OFFSET :offset";
    $params += [':limit' => CHAT_PAGE + 1, ':offset' => $offset];
    $label   = ($query['sort'] === 'top' ? 'điểm cao nhất' : 'mới nhất') . ($parts ? ', ' . implode(', ', $parts) : '');
}

try {
    [$rows, $ms] = timed(fn() => run_query($sql, $params)->fetchAll());
} catch (PDOException $e) {
    json_error('Truy vấn lỗi: ' . $e->getMessage(), 500);
}

$hasMore = count($rows) > CHAT_PAGE;
if ($hasMore) {
    array_pop($rows);
}

if (!$rows) {
    reply([
        'intent'      => $query['kind'],
        'reply'       => $offset > 0 ? 'Hết kết quả rồi.' : "Không có kết quả cho {$label}. Thử cách nói khác nhé.",
        'query_ms'    => $ms,
        'suggestions' => suggestions(),
    ]);
}

$from = $offset + 1;
$to   = $offset + count($rows);
reply([
    'intent'      => $query['kind'],
    'reply'       => "Kết quả {$from}–{$to} cho {$label}:",
    'items'       => array_map('format_story', $rows),
    'query_ms'    => $ms,
    'sql'         => squash_sql($sql),
    'state'       => $query,
    'suggestions' => $hasMore ? ['Xem thêm'] : ['Thống kê theo chủ đề', 'Top bài AI tháng này'],
]);
