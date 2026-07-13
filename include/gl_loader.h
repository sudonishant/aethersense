#pragma once

#ifdef __APPLE__
    #define GL_SILENCE_DEPRECATION
    #include <OpenGL/gl3.h>
    #include <GLFW/glfw3.h>
    inline bool init_gl_loader() { return true; }
#else
    #include <GLFW/glfw3.h>
    #include <iostream>

    // Modern OpenGL 3.3 Core Function Declarations
    typedef void (APIENTRY * PFNGLGENVERTEXARRAYSPROC) (GLsizei n, GLuint *arrays);
    typedef void (APIENTRY * PFNGLBINDVERTEXARRAYPROC) (GLuint array);
    typedef void (APIENTRY * PFNGLDELETEVERTEXARRAYSPROC) (GLsizei n, const GLuint *arrays);
    typedef void (APIENTRY * PFNGLGENBUFFERSPROC) (GLsizei n, GLuint *buffers);
    typedef void (APIENTRY * PFNGLBINDBUFFERPROC) (GLenum target, GLuint buffer);
    typedef void (APIENTRY * PFNGLBUFFERDATAPROC) (GLenum target, GLsizeiptr size, const void *data, GLenum usage);
    typedef void (APIENTRY * PFNGLDELETEBUFFERSPROC) (GLsizei n, const GLuint *buffers);
    typedef void (APIENTRY * PFNGLVERTEXATTRIBPOINTERPROC) (GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void *pointer);
    typedef void (APIENTRY * PFNGLENABLEVERTEXATTRIBARRAYPROC) (GLuint index);

    typedef GLuint (APIENTRY * PFNGLCREATESHADERPROC) (GLenum type);
    typedef void (APIENTRY * PFNGLSHADERSOURCEPROC) (GLuint shader, GLsizei count, const GLchar *const*string, const GLint *length);
    typedef void (APIENTRY * PFNGLCOMPILESHADERPROC) (GLuint shader);
    typedef void (APIENTRY * PFNGLGETSHADERIVPROC) (GLuint shader, GLenum pname, GLint *params);
    typedef void (APIENTRY * PFNGLGETSHADERINFOLOGPROC) (GLuint shader, GLsizei bufSize, GLsizei *length, GLchar *infoLog);
    typedef void (APIENTRY * PFNGLDELETESHADERPROC) (GLuint shader);

    typedef GLuint (APIENTRY * PFNGLCREATEPROGRAMPROC) (void);
    typedef void (APIENTRY * PFNGLATTACHSHADERPROC) (GLuint program, GLuint shader);
    typedef void (APIENTRY * PFNGLLINKPROGRAMPROC) (GLuint program);
    typedef void (APIENTRY * PFNGLGETPROGRAMIVPROC) (GLuint program, GLenum pname, GLint *params);
    typedef void (APIENTRY * PFNGLGETPROGRAMINFOLOGPROC) (GLuint program, GLsizei bufSize, GLsizei *length, GLchar *infoLog);
    typedef void (APIENTRY * PFNGLUSEPROGRAMPROC) (GLuint program);
    typedef void (APIENTRY * PFNGLDELETEPROGRAMPROC) (GLuint program);

    typedef GLint (APIENTRY * PFNGLGETUNIFORMLOCATIONPROC) (GLuint program, const GLchar *name);
    typedef void (APIENTRY * PFNGLUNIFORMMATRIX4FVPROC) (GLint location, GLsizei count, GLboolean transpose, const GLfloat *value);
    typedef void (APIENTRY * PFNGLUNIFORM3FVPROC) (GLint location, GLsizei count, const GLfloat *value);
    typedef void (APIENTRY * PFNGLUNIFORM1FPROC) (GLint location, GLfloat v0);
    typedef void (APIENTRY * PFNGLUNIFORM1IPROC) (GLint location, GLint v0);

    // C++17 inline definitions for dynamic gl loader
    inline PFNGLGENVERTEXARRAYSPROC glGenVertexArrays = nullptr;
    inline PFNGLBINDVERTEXARRAYPROC glBindVertexArray = nullptr;
    inline PFNGLDELETEVERTEXARRAYSPROC glDeleteVertexArrays = nullptr;
    inline PFNGLGENBUFFERSPROC glGenBuffers = nullptr;
    inline PFNGLBINDBUFFERPROC glBindBuffer = nullptr;
    inline PFNGLBUFFERDATAPROC glBufferData = nullptr;
    inline PFNGLDELETEBUFFERSPROC glDeleteBuffers = nullptr;
    inline PFNGLVERTEXATTRIBPOINTERPROC glVertexAttribPointer = nullptr;
    inline PFNGLENABLEVERTEXATTRIBARRAYPROC glEnableVertexAttribArray = nullptr;

    inline PFNGLCREATESHADERPROC glCreateShader = nullptr;
    inline PFNGLSHADERSOURCEPROC glShaderSource = nullptr;
    inline PFNGLCOMPILESHADERPROC glCompileShader = nullptr;
    inline PFNGLGETSHADERIVPROC glGetShaderiv = nullptr;
    inline PFNGLGETSHADERINFOLOGPROC glGetShaderInfoLog = nullptr;
    inline PFNGLDELETESHADERPROC glDeleteShader = nullptr;

    inline PFNGLCREATEPROGRAMPROC glCreateProgram = nullptr;
    inline PFNGLATTACHSHADERPROC glAttachShader = nullptr;
    inline PFNGLLINKPROGRAMPROC glLinkProgram = nullptr;
    inline PFNGLGETPROGRAMIVPROC glGetProgramiv = nullptr;
    inline PFNGLGETPROGRAMINFOLOGPROC glGetProgramInfoLog = nullptr;
    inline PFNGLUSEPROGRAMPROC glUseProgram = nullptr;
    inline PFNGLDELETEPROGRAMPROC glDeleteProgram = nullptr;

    inline PFNGLGETUNIFORMLOCATIONPROC glGetUniformLocation = nullptr;
    inline PFNGLUNIFORMMATRIX4FVPROC glUniformMatrix4fv = nullptr;
    inline PFNGLUNIFORM3FVPROC glUniform3fv = nullptr;
    inline PFNGLUNIFORM1FPROC glUniform1f = nullptr;
    inline PFNGLUNIFORM1IPROC glUniform1i = nullptr;

    inline bool init_gl_loader() {
        #define LOAD_PROC(type, name) \
            name = reinterpret_cast<type>(glfwGetProcAddress(#name)); \
            if (!name) { \
                std::cerr << "Failed to load OpenGL function: " << #name << std::endl; \
                return false; \
            }

        LOAD_PROC(PFNGLGENVERTEXARRAYSPROC, glGenVertexArrays);
        LOAD_PROC(PFNGLBINDVERTEXARRAYPROC, glBindVertexArray);
        LOAD_PROC(PFNGLDELETEVERTEXARRAYSPROC, glDeleteVertexArrays);
        LOAD_PROC(PFNGLGENBUFFERSPROC, glGenBuffers);
        LOAD_PROC(PFNGLBINDBUFFERPROC, glBindBuffer);
        LOAD_PROC(PFNGLBUFFERDATAPROC, glBufferData);
        LOAD_PROC(PFNGLDELETEBUFFERSPROC, glDeleteBuffers);
        LOAD_PROC(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer);
        LOAD_PROC(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray);

        LOAD_PROC(PFNGLCREATESHADERPROC, glCreateShader);
        LOAD_PROC(PFNGLSHADERSOURCEPROC, glShaderSource);
        LOAD_PROC(PFNGLCOMPILESHADERPROC, glCompileShader);
        LOAD_PROC(PFNGLGETSHADERIVPROC, glGetShaderiv);
        LOAD_PROC(PFNGLGETSHADERINFOLOGPROC, glGetShaderInfoLog);
        LOAD_PROC(PFNGLDELETESHADERPROC, glDeleteShader);

        LOAD_PROC(PFNGLCREATEPROGRAMPROC, glCreateProgram);
        LOAD_PROC(PFNGLATTACHSHADERPROC, glAttachShader);
        LOAD_PROC(PFNGLLINKPROGRAMPROC, glLinkProgram);
        LOAD_PROC(PFNGLGETPROGRAMIVPROC, glGetProgramiv);
        LOAD_PROC(PFNGLGETPROGRAMINFOLOGPROC, glGetProgramInfoLog);
        LOAD_PROC(PFNGLUSEPROGRAMPROC, glUseProgram);
        LOAD_PROC(PFNGLDELETEPROGRAMPROC, glDeleteProgram);

        LOAD_PROC(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation);
        LOAD_PROC(PFNGLUNIFORMMATRIX4FVPROC, glUniformMatrix4fv);
        LOAD_PROC(PFNGLUNIFORM3FVPROC, glUniform3fv);
        LOAD_PROC(PFNGLUNIFORM1FPROC, glUniform1f);
        LOAD_PROC(PFNGLUNIFORM1IPROC, glUniform1i);

        #undef LOAD_PROC
        return true;
    }
#endif
