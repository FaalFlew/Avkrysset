using Api.Models;

namespace TimePlanner.API.Services;

public interface ITokenService
{

    (string accessToken, string refreshToken) GenerateTokens(User user);
}