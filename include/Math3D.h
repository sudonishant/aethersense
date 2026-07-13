#pragma once

#include <cmath>
#include <algorithm>

namespace Math3D {

constexpr float PI = 3.14159265358979323846f;

inline float to_radians(float degrees) {
    return degrees * PI / 180.0f;
}

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    Vec3() = default;
    Vec3(float x, float y, float z) : x(x), y(y), z(z) {}

    Vec3 operator+(const Vec3& v) const { return {x + v.x, y + v.y, z + v.z}; }
    Vec3 operator-(const Vec3& v) const { return {x - v.x, y - v.y, z - v.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }

    Vec3& operator+=(const Vec3& v) { x += v.x; y += v.y; z += v.z; return *this; }
    Vec3& operator-=(const Vec3& v) { x -= v.x; y -= v.y; z -= v.z; return *this; }
    Vec3& operator*=(float s) { x *= s; y *= s; z *= s; return *this; }

    float length_sq() const { return x * x + y * y + z * z; }
    float length() const { return std::sqrt(length_sq()); }

    Vec3 normalize() const {
        float len = length();
        if (len > 0.0001f) {
            return {x / len, y / len, z / len};
        }
        return {0.0f, 0.0f, 0.0f};
    }

    float dot(const Vec3& v) const {
        return x * v.x + y * v.y + z * v.z;
    }

    Vec3 cross(const Vec3& v) const {
        return {
            y * v.z - z * v.y,
            z * v.x - x * v.z,
            x * v.y - y * v.x
        };
    }
};

struct Vec4 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float w = 0.0f;

    Vec4() = default;
    Vec4(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}
    Vec4(const Vec3& v, float w) : x(v.x), y(v.y), z(v.z), w(w) {}
};

struct Mat4 {
    // Stored in Column-Major order for direct OpenGL compatibility
    float m[16] = {0.0f};

    Mat4() {
        m[0] = 1.0f; m[5] = 1.0f; m[10] = 1.0f; m[15] = 1.0f; // Identity by default
    }

    static Mat4 identity() {
        return Mat4();
    }

    static Mat4 translate(const Vec3& v) {
        Mat4 result;
        result.m[12] = v.x;
        result.m[13] = v.y;
        result.m[14] = v.z;
        return result;
    }

    static Mat4 scale(const Vec3& v) {
        Mat4 result;
        result.m[0] = v.x;
        result.m[5] = v.y;
        result.m[10] = v.z;
        return result;
    }

    static Mat4 rotateX(float angle_rad) {
        Mat4 result;
        float c = std::cos(angle_rad);
        float s = std::sin(angle_rad);
        result.m[5] = c;  result.m[6] = s;
        result.m[9] = -s; result.m[10] = c;
        return result;
    }

    static Mat4 rotateY(float angle_rad) {
        Mat4 result;
        float c = std::cos(angle_rad);
        float s = std::sin(angle_rad);
        result.m[0] = c;   result.m[2] = -s;
        result.m[8] = s;   result.m[10] = c;
        return result;
    }

    static Mat4 rotateZ(float angle_rad) {
        Mat4 result;
        float c = std::cos(angle_rad);
        float s = std::sin(angle_rad);
        result.m[0] = c;   result.m[1] = s;
        result.m[4] = -s;  result.m[5] = c;
        return result;
    }

    static Mat4 perspective(float fov_rad, float aspect, float nearZ, float farZ) {
        Mat4 result;
        float f = 1.0f / std::tan(fov_rad / 2.0f);
        result.m[0] = f / aspect;
        result.m[5] = f;
        result.m[10] = (farZ + nearZ) / (nearZ - farZ);
        result.m[11] = -1.0f;
        result.m[14] = (2.0f * farZ * nearZ) / (nearZ - farZ);
        result.m[15] = 0.0f;
        return result;
    }

    static Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
        Vec3 f = (center - eye).normalize();
        Vec3 s = f.cross(up).normalize();
        Vec3 u = s.cross(f);

        Mat4 result;
        result.m[0] = s.x;
        result.m[1] = u.x;
        result.m[2] = -f.x;
        result.m[3] = 0.0f;

        result.m[4] = s.y;
        result.m[5] = u.y;
        result.m[6] = -f.y;
        result.m[7] = 0.0f;

        result.m[8] = s.z;
        result.m[9] = u.z;
        result.m[10] = -f.z;
        result.m[11] = 0.0f;

        result.m[12] = -s.dot(eye);
        result.m[13] = -u.dot(eye);
        result.m[14] = f.dot(eye);
        result.m[15] = 1.0f;

        return result;
    }

    Mat4 operator*(const Mat4& other) const {
        Mat4 result;
        for (int col = 0; col < 4; ++col) {
            for (int row = 0; row < 4; ++row) {
                float sum = 0.0f;
                for (int i = 0; i < 4; ++i) {
                    sum += m[i * 4 + row] * other.m[col * 4 + i];
                }
                result.m[col * 4 + row] = sum;
            }
        }
        return result;
    }
};

} // namespace Math3D
