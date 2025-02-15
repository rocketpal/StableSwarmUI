﻿using FreneticUtilities.FreneticToolkit;
using FreneticUtilities.FreneticDataSyntax;
using LiteDB;
using StableSwarmUI.Core;
using StableSwarmUI.DataHolders;
using StableSwarmUI.Utils;
using StableSwarmUI.Text2Image;
using FreneticUtilities.FreneticExtensions;
using System.Xml.Linq;

namespace StableSwarmUI.Accounts;

/// <summary>Represents a single user account.</summary>
public class User
{
    /// <summary>Data for the user that goes directly to the database.</summary>
    public class DatabaseEntry
    {
        [BsonId]
        public string ID { get; set; }

        /// <summary>What presets this user has saved, matched to the preset database.</summary>
        public List<string> Presets { get; set; } = new();

        /// <summary>This users stored settings data.</summary>
        public string RawSettings { get; set; } = "";
    }

    public User(SessionHandler sessions, DatabaseEntry data)
    {
        SessionHandlerSource = sessions;
        Data = data;
        Settings.Load(Program.ServerSettings.DefaultUser.Save(false));
        foreach (string field in Settings.InternalData.SharedData.Fields.Keys)
        {
            Settings.TrySetFieldModified(field, false);
        }
        Restrictions.Load(Program.ServerSettings.DefaultUserRestriction.Save(false));
        foreach (string field in Restrictions.InternalData.SharedData.Fields.Keys)
        {
            Restrictions.TrySetFieldModified(field, false);
        }
        Settings.Load(new FDSSection(data.RawSettings));
    }

    /// <summary>Save this user's data to the internal user database.</summary>
    public void Save()
    {
        Data.RawSettings = Settings.Save(false).ToString();
        lock (SessionHandlerSource.DBLock)
        {
            SessionHandlerSource.UserDatabase.Upsert(Data);
        }
    }

    /// <summary>Returns the user preset for the given name, or null if not found.</summary>
    public T2IPreset GetPreset(string name)
    {
        lock (SessionHandlerSource.DBLock)
        {
            return SessionHandlerSource.T2IPresets.FindById($"{UserID}///{name.ToLowerFast()}");
        }
    }

    /// <summary>Returns a list of all presets this user has saved.</summary>
    public List<T2IPreset> GetAllPresets()
    {
        lock (SessionHandlerSource.DBLock)
        {
            List<T2IPreset> presets = Data.Presets.Select(p => SessionHandlerSource.T2IPresets.FindById(p)).ToList();
            if (presets.Any(p => p is null))
            {
                List<string> bad = Data.Presets.Where(p => SessionHandlerSource.T2IPresets.FindById(p) is null).ToList();
                Logs.Error($"User {UserID} has presets that don't exist (database error?): {string.Join(", ", bad)}");
                presets.RemoveAll(p => p is null);
            }
            return presets;
        }
    }

    /// <summary>Saves a new preset on the user's account.</summary>
    public void SavePreset(T2IPreset preset)
    {
        lock (SessionHandlerSource.DBLock)
        {
            preset.ID = $"{UserID}///{preset.Title.ToLowerFast()}";
            SessionHandlerSource.T2IPresets.Upsert(preset.ID, preset);
            if (!Data.Presets.Contains(preset.ID))
            {
                Data.Presets.Add(preset.ID);
            }
            Save();
        }
    }

    /// <summary>Deletes a user preset, returns true if anything was deleted.</summary>
    public bool DeletePreset(string name)
    {
        lock (SessionHandlerSource.DBLock)
        {
            string id = $"{UserID}///{name.ToLowerFast()}";
            if (Data.Presets.Remove(id))
            {
                SessionHandlerSource.T2IPresets.Delete(id);
                Save();
                return true;
            }
            return false;
        }
    }

    /// <summary>The relevant sessions handler backend.</summary>
    public SessionHandler SessionHandlerSource;

    /// <summary>Any/all current sessions for this user account.</summary>
    public ConcurrentDictionary<string, Session> CurrentSessions = new();

    /// <summary>Core data for this user in the backend database.</summary>
    public DatabaseEntry Data;

    /// <summary>The short static User-ID for this user.</summary>
    public string UserID => Data.ID;

    /// <summary>What restrictions apply to this user.</summary>
    public Settings.UserRestriction Restrictions = new();

    /// <summary>This user's settings.</summary>
    public Settings.User Settings = new();

    /// <summary>Path to the output directory appropriate to this session.</summary>
    public string OutputDirectory => Program.ServerSettings.Paths.AppendUserNameToOutputPath ? $"{Program.ServerSettings.Paths.OutputPath}/{UserID}" : Program.ServerSettings.Paths.OutputPath;

    public LockObject UserLock = new();

    /// <summary>Returns whether this user has the given generic permission flag.</summary>
    public bool HasGenericPermission(string permName)
    {
        return Restrictions.PermissionFlags.Contains(permName) || Restrictions.PermissionFlags.Contains("*");
    }

    /// <summary>Converts the user's output path setting to a real path for the given parameters. Note that the path is partially cleaned, but not completely.</summary>
    public string BuildImageOutputPath(T2IParamInput user_input, int batchIndex)
    {
        int maxLen = Settings.OutPathBuilder.MaxLenPerPart;
        DateTimeOffset time = DateTimeOffset.Now;
        string buildPathPart(string part)
        {
            string data = part switch
            {
                "year" => $"{time.Year:0000}",
                "month" => $"{time.Month:00}",
                "month_name" => $"{time:MMMM}",
                "day" => $"{time.Day:00}",
                "day_name" => $"{time:dddd}",
                "hour" => $"{time.Hour:00}",
                "minute" => $"{time.Minute:00}",
                "second" => $"{time.Second:00}",
                "prompt" => user_input.Get(T2IParamTypes.Prompt),
                "negative_prompt" => user_input.Get(T2IParamTypes.NegativePrompt),
                "seed" => $"{user_input.Get(T2IParamTypes.Seed)}",
                "cfg_scale" => $"{user_input.Get(T2IParamTypes.CFGScale)}",
                "width" => $"{user_input.Get(T2IParamTypes.Width)}",
                "height" => $"{user_input.Get(T2IParamTypes.Height)}",
                "steps" => $"{user_input.Get(T2IParamTypes.Steps)}",
                "model" => user_input.Get(T2IParamTypes.Model)?.Name ?? "unknown",
                "batch_id" => $"{batchIndex}",
                "user_name" => UserID,
                "number" => "[number]",
                string other => user_input.TryGetRaw(T2IParamTypes.GetType(other, user_input), out object val) ? val.ToString() : null
            };
            if (data is null)
            {
                return null;
            }
            if (data.Length > maxLen)
            {
                data = data[..maxLen];
            }
            data = data.Replace("/", "");
            return data;
        }
        string path = Settings.OutPathBuilder.Format;
        path = StringConversionHelper.QuickSimpleTagFiller(path, "[", "]", buildPathPart);
        path = Utilities.FilePathForbidden.TrimToNonMatches(path).Replace(".", "");
        if (path.Length < 5) // Quiet trick: some short file names, eg 'CON.png', would hit Windows reserved names, so quietly break that.
        {
            path = $"{path}_";
        }
        return path;
    }
}
