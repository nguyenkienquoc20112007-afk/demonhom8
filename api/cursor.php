<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

function encode_cursor($value, int $id): string
{
    return rtrim(strtr(base64_encode(json_encode([$value, $id])), '+/', '-_'), '=');
}

function decode_cursor(string $cursor, string $sort): ?array
{
    $json = base64_decode(strtr($cursor, '-_', '+/'), true);
    $data = $json !== false ? json_decode($json, true) : null;
    if (!is_array($data) || count($data) !== 2 || !is_int($data[1])) {
        return null;
    }
    if ($sort === 'top') {
        return is_int($data[0]) ? [$data[0], $data[1]] : null;
    }
    return (is_string($data[0]) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $data[0]))
        ? [$data[0], $data[1]]
        : null;
}

$limit  = int_param('limit', 20, 5, 100);
$sort   = sort_param();
$domain = domain_param();
$col    = $sort === 'top' ? 'points' : 'created_at';

$conds  = [];
$params = [];

if ($domain !== null) {
    $conds[]           = 'domain = :domain';
    $params[':domain'] = $domain;
}

$rawCursor = (string)($_GET['cursor'] ?? '');
if ($rawCursor !== '') {
    $decoded = decode_cursor($rawCursor, $sort);
    if ($decoded === null) {
        json_error('Cursor không hợp lệ (hoặc không khớp với kiểu sắp xếp hiện tại).');
    }
    $conds[]          = "($col, id) < (:ck, :cid)";
    $params[':ck']    = $decoded[0];
    $params[':cid']   = $decoded[1];
}

$where = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';
$sql   = 'SELECT ' . story_columns() . " FROM stories $where ORDER BY $col DESC, id DESC LIMIT :limit";

[$rows, $queryMs] = timed(
    fn() => run_query($sql, $params + [':limit' => $limit + 1])->fetchAll()
);

$hasMore = count($rows) > $limit;
if ($hasMore) {
    array_pop($rows);
}

$nextCursor = null;
if ($hasMore && $rows) {
    $last       = end($rows);
    $nextCursor = encode_cursor($sort === 'top' ? (int)$last['points'] : $last['created_at'], (int)$last['id']);
}

json_out([
    'items'       => array_map('format_story', $rows),
    'next_cursor' => $nextCursor,
    'has_more'    => $hasMore,
    'query_ms'    => $queryMs,
    'sql'         => squash_sql(
        "SELECT ... FROM stories $where ORDER BY $col DESC, id DESC LIMIT " . ($limit + 1)
    ),
]);
