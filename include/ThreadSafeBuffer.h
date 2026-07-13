#pragma once

#include <mutex>
#include <vector>
#include <queue>

template <typename T>
class ThreadSafeBuffer {
public:
    ThreadSafeBuffer() = default;
    ~ThreadSafeBuffer() = default;

    // Disable copy
    ThreadSafeBuffer(const ThreadSafeBuffer&) = delete;
    ThreadSafeBuffer& operator=(const ThreadSafeBuffer&) = delete;

    // Set the latest value, overwriting the previous one
    void set_latest(const T& value) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_latestValue = value;
        m_hasValue = true;
    }

    // Get the latest value
    bool get_latest(T& value) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_hasValue) {
            return false;
        }
        value = m_latestValue;
        return true;
    }

    // Push a value onto the queue for historical processing (e.g. point cloud)
    void push_history(const T& value) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_history.push(value);
    }

    // Retrieve and clear all accumulated historical values
    std::vector<T> pop_history() {
        std::lock_guard<std::mutex> lock(m_mutex);
        std::vector<T> items;
        while (!m_history.empty()) {
            items.push_back(m_history.front());
            m_history.pop();
        }
        return items;
    }

    // Clear buffer
    void clear() {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_hasValue = false;
        while (!m_history.empty()) {
            m_history.pop();
        }
    }

private:
    std::mutex m_mutex;
    T m_latestValue{};
    bool m_hasValue = false;
    std::queue<T> m_history;
};
