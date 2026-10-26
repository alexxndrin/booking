-- Расширение для GiST-равенства по UUID/integer вместе с диапазоном
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Пользователи
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    login VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    CONSTRAINT users_login_unique UNIQUE (login),
    CONSTRAINT users_login_len CHECK (char_length(login) BETWEEN 3 AND 64),
    CONSTRAINT users_name_len CHECK (char_length(name) BETWEEN 2 AND 100),
    CONSTRAINT users_role_allowed CHECK (role IN ('пользователь', 'администратор'))
);

-- Ресурсы (переговорные)
CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    location VARCHAR(200) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT resources_name_len CHECK (char_length(name) BETWEEN 2 AND 120),
    CONSTRAINT resources_location_len CHECK (char_length(location) BETWEEN 2 AND 200)
);

-- Бронирования
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL REFERENCES resources (id),
    owner_id UUID NOT NULL REFERENCES users (id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    purpose VARCHAR(300) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Активно',
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    cancelled_at TIMESTAMP NULL,
    cancelled_by UUID NULL REFERENCES users (id),
    cancel_reason VARCHAR(300) NULL,
    CONSTRAINT bookings_purpose_len CHECK (length(purpose) >= 5 AND length(purpose) <= 300),
    CONSTRAINT bookings_end_after_start CHECK (end_time > start_time),
    CONSTRAINT bookings_status_allowed CHECK (status IN ('Активно', 'Отменено')),
    CONSTRAINT bookings_cancel_consistency CHECK (
        (status = 'Активно'
            AND cancelled_at IS NULL
            AND cancelled_by IS NULL
            AND cancel_reason IS NULL)
        OR
        (status = 'Отменено'
            AND cancelled_at IS NOT NULL
            AND cancelled_by IS NOT NULL)
    )
);

-- Пересечение [start_time, end_time) запрещено для активных записей одного ресурса
ALTER TABLE bookings
    ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (
        resource_id WITH =,
        tsrange(start_time, end_time) WITH &&
    )
    WHERE (status = 'Активно');

-- Ключи повторного запроса (Idempotency-Key), уникальны в пределах пользователя
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    booking_id UUID NOT NULL REFERENCES bookings (id),
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT idempotency_keys_user_key_unique UNIQUE (user_id, key),
    CONSTRAINT idempotency_keys_key_len CHECK (char_length(key) BETWEEN 8 AND 128)
);

-- Аудит действий
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    actor_id UUID NULL REFERENCES users (id),
    action VARCHAR(80) NOT NULL,
    object_type VARCHAR(40) NOT NULL,
    object_id UUID NULL,
    result VARCHAR(20) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    CONSTRAINT audit_logs_result_allowed CHECK (result IN ('успех', 'отказ'))
);

-- GET /api/bookings/my — свои записи по владельцу и времени
CREATE INDEX idx_bookings_owner_start
    ON bookings (owner_id, start_time DESC);

-- GET /api/resources/{id}/availability — занятые интервалы активного ресурса
CREATE INDEX idx_bookings_resource_active_interval
    ON bookings (resource_id, start_time, end_time)
    WHERE status = 'Активно';

-- GET /api/admin/audit — лента аудита по времени
CREATE INDEX idx_audit_logs_created_at
    ON audit_logs (created_at DESC);

CREATE INDEX idx_audit_logs_request_id
    ON audit_logs (request_id);